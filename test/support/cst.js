import assert from "node:assert/strict";

function parseTrees(stdout, path) {
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

// CLI status misses hidden missing tokens.
function parseCst(cst, source) {
  const rootRange =
    /^[0-9]+:[0-9]+ +- +([0-9]+):([0-9]+) +(•?)(query|ERROR)( |\n|$)/.exec(cst);
  assert.ok(rootRange, cst);
  const bytes = Buffer.from(source);
  const newlineByte = 0x0a;
  let row = 0;
  for (const byte of bytes) if (byte === newlineByte) row += 1;
  assert.deepEqual(
    rootRange.slice(1, 3).map(Number),
    [row, bytes.length - bytes.lastIndexOf(newlineByte) - 1],
    "root must reach the edited source end",
  );
  return { cst, hasError: rootRange[3] === "•" };
}

export { parseCst, parseTrees };
