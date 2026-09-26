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
  [
    "node delimiter",
    "(node)",
    {
      byte: 5,
      deleteBytes: 1,
      insert: "",
    },
    "(node",
    false,
  ],
  [
    "node name",
    "(node)",
    {
      byte: 1,
      deleteBytes: 4,
      insert: "_",
    },
    "(_)",
    true,
  ],
  [
    "adjacent bare wildcards",
    "_ _ @second",
    {
      byte: 1,
      deleteBytes: 1,
      insert: "",
    },
    "__ @second",
    true,
  ],
  [
    "bare wildcard beside a field",
    "_ field: (x)",
    {
      byte: 1,
      deleteBytes: 1,
      insert: "",
    },
    "_field: (x)",
    true,
  ],
  [
    "wildcard inserted before a field name",
    "field: (x)",
    {
      byte: 0,
      deleteBytes: 0,
      insert: "_",
    },
    "_field: (x)",
    true,
  ],
  [
    "leading underscore in a node name",
    "(x)",
    {
      byte: 1,
      deleteBytes: 0,
      insert: "_",
    },
    "(_x)",
    true,
  ],
  [
    "wildcard cannot become a field name",
    "(node _ (_))",
    {
      byte: 7,
      deleteBytes: 0,
      insert: ":",
    },
    "(node _: (_))",
    false,
  ],
  [
    "top-level field chain",
    "field: (node) @x",
    {
      byte: 7,
      deleteBytes: 0,
      insert: "inner: ",
    },
    "field: inner: (node) @x",
    true,
  ],
  [
    "group field constraint",
    "((node) (child))",
    {
      byte: 8,
      deleteBytes: 0,
      insert: "field: ",
    },
    "((node) field: (child))",
    true,
  ],
  [
    "alternant field constraint",
    "[(node) (child)]",
    {
      byte: 8,
      deleteBytes: 0,
      insert: "field: ",
    },
    "[(node) field: (child)]",
    true,
  ],
  [
    "anchor before a call",
    "(node (#check?))",
    {
      byte: 6,
      deleteBytes: 0,
      insert: ". ",
    },
    "(node . (#check?))",
    true,
  ],
  [
    "call between anchors",
    "(node . (#check?) . (child))",
    {
      byte: 8,
      deleteBytes: 9,
      insert: "",
    },
    "(node .  . (child))",
    false,
  ],
  [
    "last matching child in a group before a trailing anchor",
    "(node ((#check?) (child)) .)",
    {
      byte: 17,
      deleteBytes: 7,
      insert: "",
    },
    "(node ((#check?) ) .)",
    false,
  ],
  [
    "last matching child in an alternation before a trailing anchor",
    "(node [(#check?) (child)] .)",
    {
      byte: 17,
      deleteBytes: 7,
      insert: "",
    },
    "(node [(#check?) ] .)",
    false,
  ],
  [
    "missing node type cannot become a field name",
    "(MISSING field (_))",
    {
      byte: 14,
      deleteBytes: 0,
      insert: ":",
    },
    "(MISSING field: (_))",
    false,
  ],
  [
    "wildcard becomes a supertype name",
    "(_)",
    {
      byte: 2,
      deleteBytes: 0,
      insert: "/node",
    },
    "(_/node)",
    true,
  ],
  [
    "missing marker cannot become a supertype name",
    "(MISSING)",
    {
      byte: 8,
      deleteBytes: 0,
      insert: "/node",
    },
    "(MISSING/node)",
    false,
  ],
  [
    "missing node supertype",
    "(MISSING type)",
    {
      byte: 13,
      deleteBytes: 0,
      insert: "/subtype",
    },
    "(MISSING type/subtype)",
    true,
  ],
  [
    "missing type before a child",
    "(MISSING node (_))",
    {
      byte: 9,
      deleteBytes: 5,
      insert: "",
    },
    "(MISSING (_))",
    false,
  ],
  [
    "carriage return inside a comment",
    ";a b\n(_)",
    {
      byte: 2,
      deleteBytes: 1,
      insert: "\r",
    },
    ";a\rb\n(_)",
    true,
  ],
  [
    "capture name",
    "(node) @capture",
    {
      byte: 8,
      deleteBytes: 7,
      insert: "",
    },
    "(node) @",
    false,
  ],
  [
    "UTF-8 string",
    '(#custom? "日\\"本")',
    {
      byte: 11,
      deleteBytes: 3,
      insert: "語",
    },
    '(#custom? "語\\"本")',
    true,
  ],
  [
    "alternation delimiter",
    "[(node)] @set",
    {
      byte: 0,
      deleteBytes: 1,
      insert: "(",
    },
    "((node)] @set",
    false,
  ],
  [
    "comment prefix",
    "; text\r\n(node)",
    {
      byte: 0,
      deleteBytes: 1,
      insert: "",
    },
    " text\r\n(node)",
    false,
  ],
  [
    "BOM",
    "(node)\n",
    {
      byte: 0,
      deleteBytes: 0,
      insert: "﻿",
    },
    "﻿(node)\n",
    true,
  ],
  [
    "anchored child",
    "(node . (_) !absent)",
    {
      byte: 8,
      deleteBytes: 3,
      insert: "",
    },
    "(node .  !absent)",
    false,
  ],
  [
    "anchored sibling",
    "((_) . (_) (#check?))",
    {
      byte: 7,
      deleteBytes: 3,
      insert: "",
    },
    "((_) .  (#check?))",
    true,
  ],
  [
    "escape boundary",
    '"a\\\\b"',
    {
      byte: 2,
      deleteBytes: 1,
      insert: "",
    },
    '"a\\b"',
    true,
  ],
  [
    "string content",
    '((node) (#custom? "text"))',
    {
      byte: 22,
      deleteBytes: 1,
      insert: "",
    },
    '((node) (#custom? "tex"))',
    true,
  ],
  [
    "call delimiter",
    '((node) (#custom? "text"))',
    {
      byte: 24,
      deleteBytes: 1,
      insert: "",
    },
    '((node) (#custom? "text")',
    false,
  ],
];

for (const [name, initial, edit, expected, valid] of cases) {
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
        for (const character of source) {
          boundaries.push(boundaries.at(-1) + Buffer.byteLength(character));
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
