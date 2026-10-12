import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { root } from "../scripts/tree-sitter.js";
import { parseCorpus } from "./support/corpus.js";
import { parseCst, parseTrees } from "./support/cst.js";
import { assertEditRoundTrip, parse } from "./support/parser.js";

const corpusDirectory = join(root, "test/corpus");
for (const file of readdirSync(corpusDirectory).sort()) {
  assert.ok(file.endsWith(".txt"), `unexpected corpus entry: ${file}`);
  const entries = parseCorpus(
    readFileSync(join(corpusDirectory, file), "utf8"),
  );
  for (const { name, source } of entries) {
    test(`query: corpus source coverage and fresh determinism: ${file}: ${name}`, () => {
      parse(source);
    });
  }
}

test("query: corpus inputs retain BOM NUL CRLF and surrounding whitespace", () => {
  const text = [
    "==================\nEmpty\n==================\n\n---\n(query)\n\n",
    "==================\nLayout\n:cst\n==================\n",
    "\uFEFF \t\r\n(node)\n\n\n---\nignored output\n\n",
    "==================\nNUL\n:error\n==================\n",
    "\n(node)\0(other)\n---\n",
  ].join("");
  assert.deepEqual(parseCorpus(text), [
    { name: "Empty", source: "" },
    { name: "Layout", source: "\uFEFF \t\r\n(node)\n\n" },
    { name: "NUL", source: "\n(node)\0(other)" },
  ]);
});

test("query: corpus input reader rejects unsupported conditions and framing", () => {
  for (const text of [
    "not a corpus file",
    "==================\nUnclosed header\n",
    "==================\nSkipped\n:skip\n==================\n(node)\n---\n",
    "==================\nNo separator\n==================\n(node)\n",
    "==================\nTrailing CR\n==================\n(node)\r\n---\n",
  ]) {
    assert.throws(() => parseCorpus(text), { code: "ERR_ASSERTION" }, text);
  }
});

test("query: alternation metadata requires at least one member", () => {
  const nodeTypes = JSON.parse(
    readFileSync(join(root, "src", "node-types.json"), "utf8"),
  );
  const alternation = nodeTypes.find((node) => node.type === "alternation");
  assert.deepEqual(alternation.children, {
    multiple: true,
    required: true,
    types: [
      { type: "directive", named: true },
      { type: "field_constraint", named: true },
      { type: "pattern", named: true },
      { type: "predicate", named: true },
    ],
  });
});

test("query: CST output separates repeated parses without consuming source display lines", () => {
  const output = [
    "0:0 - 1:0 query",
    "0:0 - 0:6   string `a日`",
    "input.scm Parse: 1 ms",
    "0:0 - 1:0 •ERROR",
    "input.scm is source text",
    "input.scm Parse: 2 ms",
    " Edit: 0.01 ms",
  ].join("\n");
  assert.deepEqual(parseTrees(output, "input.scm"), [
    "0:0 - 1:0 query\n0:0 - 0:6   string `a日`",
    "0:0 - 1:0 •ERROR\ninput.scm is source text",
  ]);
});

test("query: root completeness uses UTF-8 bytes and retains hidden recovery markers", () => {
  for (const { source, cst, hasError } of [
    { source: "", cst: "0:0 - 0:0 query", hasError: false },
    { source: '"日"', cst: "0:0 - 0:5 query", hasError: false },
    { source: '(a)\r\n"日', cst: "0:0 - 1:4 •query", hasError: true },
    { source: ")\n", cst: "0:0 - 1:0 •ERROR", hasError: true },
  ]) {
    assert.deepEqual(parseCst(cst, source), { cst, hasError });
  }
  for (const cst of ["", "0:0 - 0:3 query", "0:0 - 0:4 query"]) {
    assert.throws(() => parseCst(cst, '"日"'), { code: "ERR_ASSERTION" }, cst);
  }
});

const cases = [
  {
    name: "UTF-8 string",
    initial: '(#custom? "日\\"本")',
    edit: {
      byte: 11,
      deleteBytes: 3,
      insert: "語",
    },
    expected: '(#custom? "語\\"本")',
    valid: true,
  },
  {
    name: "BOM",
    initial: "(node)\n",
    edit: {
      byte: 0,
      deleteBytes: 0,
      insert: "﻿",
    },
    expected: "﻿(node)\n",
    valid: true,
  },
];

for (const entry of cases) {
  test(`query: edits and restores ${entry.name}`, () => {
    assertEditRoundTrip(entry);
  });
}
