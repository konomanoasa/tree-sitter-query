import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before } from "node:test";
import { createTreeSitter, root } from "../../scripts/tree-sitter.js";

import { parseCst, parseTrees } from "./cst.js";

const buildTimeoutMs = 60_000;
const parseTimeoutMs = 30_000;

let runner;
let library;

before(() => {
  runner = createTreeSitter();
  library = join(
    runner.directory,
    process.platform === "win32" ? "parser.dll" : "parser",
  );
  const result = runner.run(["build", "--output", library, root], {
    timeout: buildTimeoutMs,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

after(() => {
  runner?.close();
});

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
    const result = runner.run(args, { timeout: parseTimeoutMs });
    assert.ifError(result.error);
    assert.ok(result.status === 0 || result.status === 1, result.stderr);
    const parsed = parseTrees(result.stdout, path);
    assert.equal(
      parsed.length,
      repeated ? 2 : 1,
      result.stdout + result.stderr,
    );
    if (repeated) {
      assert.equal(parsed[1], parsed[0], "a repeated fresh parse must match");
    }
    const cst = parsed[0];
    return parseCst(cst, bytes);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function assertIncrementalEqualsFresh(initial, edits, source, valid) {
  const description = JSON.stringify({ initial, edits, source });
  const fresh = parse(source);
  const incremental = parse(initial, edits);
  if (valid !== undefined) {
    assert.equal(fresh.hasError, !valid, description);
    assert.equal(incremental.hasError, !valid, description);
  }
  if (!fresh.hasError) {
    assert.equal(incremental.hasError, false, description);
    assert.equal(incremental.cst, fresh.cst, description);
  }
}

function assertEditRoundTrip({ initial, edit, expected, valid }) {
  const { byte, deleteBytes, insert } = edit;
  const edited = applyEdits(initial, [edit]).toString();
  assert.equal(
    edited,
    expected,
    "edit fixture must produce the explicit expected input",
  );
  assertIncrementalEqualsFresh(initial, [edit], expected, valid);
  const restore = {
    byte,
    deleteBytes: Buffer.byteLength(insert),
    insert: Buffer.from(initial)
      .subarray(byte, byte + deleteBytes)
      .toString(),
  };
  assert.equal(applyEdits(edited, [restore]).toString(), initial);
  assertIncrementalEqualsFresh(initial, [edit, restore], initial, true);
}

export { applyEdits, assertEditRoundTrip, assertIncrementalEqualsFresh, parse };
