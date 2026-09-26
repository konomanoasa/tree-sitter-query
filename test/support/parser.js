import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before } from "node:test";
import { createTreeSitter, root } from "../../scripts/tree-sitter.js";

let runner;
let library;

before(() => {
  runner = createTreeSitter();
  library = join(
    runner.directory,
    process.platform === "win32" ? "parser.dll" : "parser",
  );
  const result = runner.run(["build", "--output", library, root], {
    timeout: 60000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

after(() => {
  runner?.close();
});

// --time separates per-file CSTs; exclude its timings from comparisons.
function trees(stdout, path) {
  const parsed = [];
  let lines = [];
  for (const line of stdout.split("\n")) {
    if (
      line.startsWith(path) &&
      /^[ \t]+Parse:[ \t]/.test(line.slice(path.length))
    ) {
      parsed.push(lines.join("\n"));
      lines = [];
    } else if (!/^[ \t]*Edit:[ \t]/.test(line)) {
      lines.push(line);
    }
  }
  return parsed;
}

function applyEdits(source, edits) {
  let bytes = Buffer.from(source);
  for (const edit of edits) {
    const { byte, deleteBytes, insert } = edit;
    const description = JSON.stringify(edit);
    assert.ok(
      Number.isSafeInteger(byte) && byte >= 0,
      `invalid byte offset: ${description}`,
    );
    assert.ok(
      Number.isSafeInteger(deleteBytes) && deleteBytes >= 0,
      `invalid deletion length: ${description}`,
    );
    assert.equal(typeof insert, "string", `invalid insertion: ${description}`);
    assert.ok(
      byte <= bytes.length && deleteBytes <= bytes.length - byte,
      `edit exceeds ${bytes.length} source bytes: ${description}`,
    );
    bytes = Buffer.concat([
      bytes.subarray(0, byte),
      Buffer.from(insert),
      bytes.subarray(byte + deleteBytes),
    ]);
  }
  return bytes;
}

// The CLI exit status misses hidden missing tokens; use the root --cst marker.
// Repeat unchanged inputs on one parser to check determinism, including recovery.
function parse(source, edits = []) {
  const directory = mkdtempSync(join(runner.directory, "input-"));
  try {
    const path = join(directory, "input.scm");
    writeFileSync(path, source);
    const args = [
      "parse",
      "--cst",
      "--time",
      "--lib-path",
      library,
      "--lang-name",
      "query",
      path,
    ];
    let bytes = Buffer.from(source);
    for (const { byte, deleteBytes, insert } of edits) {
      bytes = applyEdits(bytes, [{ byte, deleteBytes, insert }]);
      args.push("--edits", `${byte} ${deleteBytes} ${insert}`);
    }
    const repeated = edits.length === 0;
    if (repeated) args.push(path);
    const result = runner.run(args, { timeout: 30000 });
    assert.ifError(result.error);
    assert.ok(result.status === 0 || result.status === 1, result.stderr);
    const parsed = trees(result.stdout, path);
    assert.equal(
      parsed.length,
      repeated ? 2 : 1,
      result.stdout + result.stderr,
    );
    if (repeated) {
      assert.equal(parsed[1], parsed[0], "a repeated fresh parse must match");
    }
    const cst = parsed[0];
    const rootRange =
      /^[0-9]+:[0-9]+ +- +([0-9]+):([0-9]+) +(•?)(query|ERROR)( |\n|$)/.exec(
        cst,
      );
    assert.notEqual(rootRange, null, cst);
    let row = 0;
    for (const byte of bytes) if (byte === 10) row += 1;
    assert.deepEqual(
      rootRange.slice(1, 3).map(Number),
      [row, bytes.length - bytes.lastIndexOf(10) - 1],
      "root must reach the edited source end",
    );
    return { cst, hasError: rootRange[3] === "•" };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export { applyEdits, parse };
