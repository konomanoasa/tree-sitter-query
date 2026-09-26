import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { root } from "../scripts/tree-sitter.js";
import { parse } from "./support/parser.js";

const invalidCases = [
  ["unclosed node", "(node"],
  ["unclosed string", '"unterminated'],
  ["space after capture prefix", "(node) @ name"],
  ["comment after capture prefix", "(node) @; comment\nname"],
  ["newline in string", '"line\nbreak"'],
  ["empty group", "()"],
  ["bare wildcard opening a group", "(_ @x)"],
  ["quantified bare wildcard opening a group", "(_+ _)"],
  ["empty alternation", "[]"],
  ["anchor without child", "(node .)"],
  ["leading anchor with only a negated field", "(node . !absent)"],
  ["trailing anchor with only a negated field", "(node !absent .)"],
  ["trailing anchor with only a predicate", "(node (#check?) .)"],
  ["trailing anchor with only a directive", "(node (#set! key value) .)"],
  ["trailing anchor after an anchored call", "(node . (#check?) .)"],
  [
    "trailing anchor after an unrelated top-level pattern",
    "(other) (node (#check?) .)",
  ],
  ["negated field after leading anchor", "(node . !absent (child))"],
  ["negated field after trailing anchor", "(node (child) . !absent)"],
  [
    "comment before negated field after anchor",
    "(node . ; comment\n !absent (child))",
  ],
  [
    "anchors separated only by metadata",
    "(node (child) . !absent (#check?) . (other))",
  ],
  ["anchor without a parent pattern", "(node) ."],
  ["leading group anchor", "(. (node))"],
  ["trailing group anchor", "((node) .)"],
  ["leading group anchor before a call", "(. (#check?) (node))"],
  ["trailing group anchor after a call", "((node) (#check?) .)"],
  ["leading alternation anchor", "[. (node)]"],
  ["anchor between alternants", "[(node) . (other)]"],
  ["trailing alternation anchor", "[(node) .]"],
  ["consecutive anchors", "(node (_) . . (_))"],
  ["call without marker", "(#name)"],
  ["space after call prefix", "(# name?)"],
  ["space before call marker", "(#name ?)"],
  ["capture on predicate", "(#name?) @capture"],
  ["quantifier on directive", "(#name!)?"],
  ["call as a field target", "(node field: (#check?))"],
  ["missing capture name", "(node) @"],
  ["missing negated field", "(node !)"],
  ["missing field pattern", "(node field:)"],
  ["wildcard as field name", "(node _: (_))"],
  ["wildcard as top-level field name", "_: (_)"],
  ["wildcard as group field name", "((node) _: (_))"],
  ["wildcard as alternant field name", "[_: (_)]"],
  ["wildcard as chained field name", "field: _: (_)"],
  ["child after untyped MISSING", "(MISSING (_))"],
  ["field after untyped MISSING", "(MISSING field: (_))"],
  ["wildcard field after untyped MISSING", "(MISSING _: (_))"],
  ["untyped MISSING as supertype", "(MISSING/node)"],
  ["space before supertype separator", "(node /subtype)"],
  ["space after supertype separator", "(node/ subtype)"],
  ["comment before missing node subtype", "(MISSING node/; comment\nsubtype)"],
  ["NUL between patterns", "(node)\0(other)"],
];

for (const [name, source] of invalidCases) {
  test(`query: rejects ${name}`, () => {
    const result = parse(source);
    assert.equal(result.hasError, true, result.cst);
  });
}

const consumerCases = [
  ["unknown nodes and fields", "(unknown field: (other) !absent)"],
  ["unresolved supertype", "(unknown/subtype)"],
  [
    "custom calls and unresolved captures",
    "((node) (#eq?) (#custom! @undefined))",
  ],
  ["unknown missing node type", "(MISSING unknown)"],
  ["unknown missing node supertype", "(MISSING unknown/subtype)"],
  ["chained field constraints", "(node first: second: (child))"],
];

for (const [name, source] of consumerCases) {
  test(`query: leaves ${name} to consumers`, () => {
    const result = parse(source);
    assert.equal(result.hasError, false, result.cst);
  });
}

test("query: trailing anchors require a matching child in the same node pattern", () => {
  for (const calls of [
    "((#check?))",
    "[(#check?)]",
    "(((#check? @unresolved)))",
    '((#check? "text" _name))',
    "((#check?))? @x",
    "[[(#check?)] ((#other!))]",
    "field: inner: ((#check?))",
  ]) {
    for (const [source, valid] of [
      [`(node ${calls})`, true],
      [`(node . ${calls})`, true],
      [`(node ${calls} .)`, false],
      [`(other) (node ${calls} .)`, false],
      [`(node ${calls} .) (other)`, false],
      [`(node (child)? ${calls} .)`, true],
      [`(node ${calls} (child)* .)`, true],
    ]) {
      const result = parse(source);
      assert.equal(result.hasError, !valid, `${source}\n${result.cst}`);
    }
  }
});

test("query: anchors retain child patterns across calls, comments and field constraints", () => {
  const patterns = [
    "_",
    "(child)",
    '"token"',
    "[(child) _]",
    "((a) (b))",
    "field: (_)",
    "((#check?) (child)?)",
    "[(#check?) field: _*]",
    "field: ([((#check?)) inner: ((child)*)])",
  ];
  const annotations = [
    "",
    "(#check? @unresolved)",
    "(#set! key value)",
    "; note\n",
  ];
  for (const child of patterns) {
    for (const annotation of annotations) {
      for (const source of [
        `(parent ${annotation} . ${annotation} ${child} ${annotation} . ${annotation})`,
        `(parent ${child} ${annotation} . ${annotation} ${child})`,
      ]) {
        const result = parse(source);
        assert.equal(result.hasError, false, `${source}\n${result.cst}`);
      }
    }
  }
});

test("query: bare wildcards need no separator before another pattern", () => {
  for (const source of [
    "__ @second",
    "_field: (x)",
    "(node __ @second _field: (x))",
    "((x) _field: (y) __)",
    "[__ _field: (x)]",
    "field: _inner: (x)",
  ]) {
    const result = parse(source);
    assert.equal(result.hasError, false, `${source}\n${result.cst}`);
  }
});

const callAnchorCases = [
  ["a predicate without children", "(node . (#check?))"],
  ["a directive without children", "(node . (#set! key value))"],
  ["a call before a negated field", "(node . (#check?) !absent)"],
  ["a negated field before a child", "(node !absent . (child))"],
  ["a negated field before a trailing anchor", "(node (child) !absent .)"],
  ["calls between leading anchors", "(node . (#check?) . (child))"],
  ["calls between trailing anchors", "(node (child) . (#check?) .)"],
  ["a group call before a child", "((#check?) . (child))"],
  ["a group call after a child", "((child) . (#check?))"],
  ["a group containing only calls", "((#check?) . (#other?))"],
  ["group calls between anchors", "((child) . (#check?) . (other))"],
];

for (const [name, source] of callAnchorCases) {
  test(`query: accepts anchors with ${name}`, () => {
    const result = parse(source);
    assert.equal(result.hasError, false, result.cst);
  });
}

test("query: parses the shipped highlight query as query source", () => {
  const result = parse(
    readFileSync(join(root, "queries/highlights.scm"), "utf8"),
  );
  assert.equal(result.hasError, false, result.cst);
});
