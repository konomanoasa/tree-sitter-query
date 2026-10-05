import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEdits, parse } from "./support/parser.js";

// Recovery shapes are outside the contract, so an invalid source only has to
// parse; parse() still checks that each tree covers the edited source.
function compare(initial, edits, source, valid) {
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

const cases = [
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

for (const { name, initial, edit, expected, valid } of cases) {
  test(`query: edits and restores ${name}`, () => {
    const { byte, deleteBytes, insert } = edit;
    const edited = applyEdits(initial, [edit]).toString();
    assert.equal(
      edited,
      expected,
      "edit fixture must produce the explicit expected input",
    );
    compare(initial, [edit], expected, valid);
    const restore = {
      byte,
      deleteBytes: Buffer.byteLength(insert),
      insert: Buffer.from(initial)
        .subarray(byte, byte + deleteBytes)
        .toString(),
    };
    assert.equal(applyEdits(edited, [restore]).toString(), initial);
    compare(initial, [edit, restore], initial, true);
  });
}

test("query: fixed-seed generated histories match fresh parses and restore valid source structure", () => {
  const inputs = [
    "(node . (#check?) field: (_) @x !absent .)",
    "[(a)+ (b)]? @all",
    '((node) (#custom? @x "日\\t本"))',
    '; text\r\n(MISSING ";")',
    "(MISSING _ field: (_)) (_/MISSING) (MISSING type/subtype)",
    "outer: inner: (node)+ @x [left: (_) right: _]",
    "((#first?) . body: (node . (#check?) . (child)) . (#last!))",
    "(node __ @x [(#check?) field: ((child)?)] ((#other!)) .)",
  ];
  const insertions = [
    "",
    "(",
    ")",
    "[",
    "]",
    '"',
    "\\",
    ";",
    "#",
    "\n",
    "\r\n",
    "@x",
    "?",
    ".",
    "語",
    " ",
  ];
  let state = 0x61c8d942;
  const next = (maximum) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % maximum;
  };
  for (const initial of inputs) {
    assert.equal(parse(initial).hasError, false);
    for (let history = 0; history < 40; history++) {
      let source = initial;
      const edits = [];
      const undo = [];
      for (let step = 0; step < 8; step++) {
        const boundaries = [0];
        let offset = 0;
        for (const character of source) {
          offset += Buffer.byteLength(character);
          boundaries.push(offset);
        }
        const index = next(boundaries.length);
        const byte = boundaries[index];
        const end =
          boundaries[Math.min(index + next(3), boundaries.length - 1)];
        const insert = insertions[next(insertions.length)];
        undo.unshift({
          byte,
          deleteBytes: Buffer.byteLength(insert),
          insert: Buffer.from(source).subarray(byte, end).toString(),
        });
        const edit = { byte, deleteBytes: end - byte, insert };
        source = applyEdits(source, [edit]).toString();
        edits.push(edit);
        compare(initial, edits, source);
      }
      for (const edit of undo) {
        source = applyEdits(source, [edit]).toString();
        edits.push(edit);
        compare(initial, edits, source);
      }
      assert.equal(source, initial, `history ${history}`);
    }
  }
});
