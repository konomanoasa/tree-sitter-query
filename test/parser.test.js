import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { root } from "../scripts/tree-sitter.js";
import { assertEditRoundTrip, parse } from "./support/parser.js";

test("query: completes recovery for long sequences of invalid trailing anchors", () => {
  for (const unit of ["(node .)\n", "((a) .)\n", "(a/b .)\n", "(node [.])\n"]) {
    const repetitionCount = 6_000;
    const result = parse(unit.repeat(repetitionCount));
    assert.equal(result.hasError, true, unit);
  }
});

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

test("query: parses the shipped highlight query as query source", () => {
  const result = parse(
    readFileSync(join(root, "queries/highlights.scm"), "utf8"),
  );
  assert.equal(result.hasError, false, result.cst);
});

const cases = [
  {
    name: "newline before comment-like string content and NUL",
    initial: '";x\0"',
    edit: { byte: 1, deleteBytes: 0, insert: "\n" },
    expected: '"\n;x\0"',
    valid: false,
  },
  {
    name: "newline before comment-like predicate argument and NUL",
    initial: '(#custom? ";x\0")',
    edit: { byte: 11, deleteBytes: 0, insert: "\n" },
    expected: '(#custom? "\n;x\0")',
    valid: false,
  },
  {
    name: "newline before comment-like directive argument and NUL",
    initial: '(#custom! ";x\0")',
    edit: { byte: 11, deleteBytes: 0, insert: "\n" },
    expected: '(#custom! "\n;x\0")',
    valid: false,
  },
  {
    name: "newline before comment-like subtype and NUL",
    initial: '(node/";x\0")',
    edit: { byte: 7, deleteBytes: 0, insert: "\n" },
    expected: '(node/"\n;x\0")',
    valid: false,
  },
  {
    name: "escape before a string newline and comment-like content",
    initial: '"\\\n;x\0"',
    edit: { byte: 1, deleteBytes: 1, insert: "" },
    expected: '"\n;x\0"',
    valid: false,
  },
  {
    name: "node delimiter",
    initial: "(node)",
    edit: {
      byte: 5,
      deleteBytes: 1,
      insert: "",
    },
    expected: "(node",
    valid: false,
  },
  {
    name: "node name",
    initial: "(node)",
    edit: {
      byte: 1,
      deleteBytes: 4,
      insert: "_",
    },
    expected: "(_)",
    valid: true,
  },
  {
    name: "adjacent bare wildcards",
    initial: "_ _ @second",
    edit: {
      byte: 1,
      deleteBytes: 1,
      insert: "",
    },
    expected: "__ @second",
    valid: true,
  },
  {
    name: "bare wildcard beside a field",
    initial: "_ field: (x)",
    edit: {
      byte: 1,
      deleteBytes: 1,
      insert: "",
    },
    expected: "_field: (x)",
    valid: true,
  },
  {
    name: "wildcard inserted before a field name",
    initial: "field: (x)",
    edit: {
      byte: 0,
      deleteBytes: 0,
      insert: "_",
    },
    expected: "_field: (x)",
    valid: true,
  },
  {
    name: "leading underscore in a node name",
    initial: "(x)",
    edit: {
      byte: 1,
      deleteBytes: 0,
      insert: "_",
    },
    expected: "(_x)",
    valid: true,
  },
  {
    name: "wildcard cannot become a field name",
    initial: "(node _ (_))",
    edit: {
      byte: 7,
      deleteBytes: 0,
      insert: ":",
    },
    expected: "(node _: (_))",
    valid: false,
  },
  {
    name: "top-level field chain",
    initial: "field: (node) @x",
    edit: {
      byte: 7,
      deleteBytes: 0,
      insert: "inner: ",
    },
    expected: "field: inner: (node) @x",
    valid: true,
  },
  {
    name: "group field constraint",
    initial: "((node) (child))",
    edit: {
      byte: 8,
      deleteBytes: 0,
      insert: "field: ",
    },
    expected: "((node) field: (child))",
    valid: true,
  },
  {
    name: "alternant field constraint",
    initial: "[(node) (child)]",
    edit: {
      byte: 8,
      deleteBytes: 0,
      insert: "field: ",
    },
    expected: "[(node) field: (child)]",
    valid: true,
  },
  {
    name: "anchor before a call",
    initial: "(node (#check?))",
    edit: {
      byte: 6,
      deleteBytes: 0,
      insert: ". ",
    },
    expected: "(node . (#check?))",
    valid: true,
  },
  {
    name: "call between anchors",
    initial: "(node . (#check?) . (child))",
    edit: {
      byte: 8,
      deleteBytes: 9,
      insert: "",
    },
    expected: "(node .  . (child))",
    valid: false,
  },
  {
    name: "last matching child in a group before a trailing anchor",
    initial: "(node ((#check?) (child)) .)",
    edit: {
      byte: 17,
      deleteBytes: 7,
      insert: "",
    },
    expected: "(node ((#check?) ) .)",
    valid: false,
  },
  {
    name: "last matching child in an alternation before a trailing anchor",
    initial: "(node [(#check?) (child)] .)",
    edit: {
      byte: 17,
      deleteBytes: 7,
      insert: "",
    },
    expected: "(node [(#check?) ] .)",
    valid: false,
  },
  {
    name: "missing node type cannot become a field name",
    initial: "(MISSING field (_))",
    edit: {
      byte: 14,
      deleteBytes: 0,
      insert: ":",
    },
    expected: "(MISSING field: (_))",
    valid: false,
  },
  {
    name: "wildcard becomes a supertype name",
    initial: "(_)",
    edit: {
      byte: 2,
      deleteBytes: 0,
      insert: "/node",
    },
    expected: "(_/node)",
    valid: true,
  },
  {
    name: "missing marker cannot become a supertype name",
    initial: "(MISSING)",
    edit: {
      byte: 8,
      deleteBytes: 0,
      insert: "/node",
    },
    expected: "(MISSING/node)",
    valid: false,
  },
  {
    name: "missing node supertype",
    initial: "(MISSING type)",
    edit: {
      byte: 13,
      deleteBytes: 0,
      insert: "/subtype",
    },
    expected: "(MISSING type/subtype)",
    valid: true,
  },
  {
    name: "missing type before a child",
    initial: "(MISSING node (_))",
    edit: {
      byte: 9,
      deleteBytes: 5,
      insert: "",
    },
    expected: "(MISSING (_))",
    valid: false,
  },
  {
    name: "carriage return inside a comment",
    initial: ";a b\n(_)",
    edit: {
      byte: 2,
      deleteBytes: 1,
      insert: "\r",
    },
    expected: ";a\rb\n(_)",
    valid: true,
  },
  {
    name: "capture name",
    initial: "(node) @capture",
    edit: {
      byte: 8,
      deleteBytes: 7,
      insert: "",
    },
    expected: "(node) @",
    valid: false,
  },
  {
    name: "alternation delimiter",
    initial: "[(node)] @set",
    edit: {
      byte: 0,
      deleteBytes: 1,
      insert: "(",
    },
    expected: "((node)] @set",
    valid: false,
  },
  {
    name: "comment prefix",
    initial: "; text\r\n(node)",
    edit: {
      byte: 0,
      deleteBytes: 1,
      insert: "",
    },
    expected: " text\r\n(node)",
    valid: false,
  },
  {
    name: "anchored child",
    initial: "(node . (_) !absent)",
    edit: {
      byte: 8,
      deleteBytes: 3,
      insert: "",
    },
    expected: "(node .  !absent)",
    valid: false,
  },
  {
    name: "anchored sibling",
    initial: "((_) . (_) (#check?))",
    edit: {
      byte: 7,
      deleteBytes: 3,
      insert: "",
    },
    expected: "((_) .  (#check?))",
    valid: true,
  },
  {
    name: "escape boundary",
    initial: '"a\\\\b"',
    edit: {
      byte: 2,
      deleteBytes: 1,
      insert: "",
    },
    expected: '"a\\b"',
    valid: true,
  },
  {
    name: "string content",
    initial: '((node) (#custom? "text"))',
    edit: {
      byte: 22,
      deleteBytes: 1,
      insert: "",
    },
    expected: '((node) (#custom? "tex"))',
    valid: true,
  },
  {
    name: "call delimiter",
    initial: '((node) (#custom? "text"))',
    edit: {
      byte: 24,
      deleteBytes: 1,
      insert: "",
    },
    expected: '((node) (#custom? "text")',
    valid: false,
  },
];

for (const entry of cases) {
  test(`query: edits and restores ${entry.name}`, () => {
    assertEditRoundTrip(entry);
  });
}
