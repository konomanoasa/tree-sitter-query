import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { root } from "../scripts/tree-sitter.js";
import { parseCst, parseTrees } from "./support/cst.js";
import { parse } from "./support/parser.js";

function parseCorpus(text) {
  const sections = text.split("==================\n");
  assert.equal(sections.shift(), "", "corpus must begin with a header");
  assert.equal(sections.length % 2, 0, "corpus headers must be paired");
  const cases = [];
  for (let index = 0; index < sections.length; index += 2) {
    const [name, ...attributes] = sections[index].trimEnd().split("\n");
    assert.ok(name, "corpus case must have a name");
    for (const attribute of attributes) {
      assert.ok(
        attribute === ":cst" || attribute === ":error",
        `unsupported corpus attribute: ${attribute}`,
      );
    }
    const parts = sections[index + 1].split("\n---\n");
    assert.equal(parts.length, 2, `${name}: expected one output separator`);
    const source = parts[0];
    assert.ok(
      !source.endsWith("\r"),
      `${name}: a trailing CR would be stripped by the corpus reader`,
    );
    cases.push({ name, source });
  }
  return cases;
}

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
