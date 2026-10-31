import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyEdits,
  assertEditRoundTrip,
  assertIncrementalEqualsFresh,
  parse,
} from "./support/parser.js";

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
];

for (const entry of cases) {
  test(`query: edits and restores ${entry.name}`, () => {
    assertEditRoundTrip(entry);
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
  const seed = 0x61c8d942;
  const historiesPerInput = 2;
  const editsBeforeRestore = 2;
  const maxDeletedCharacters = 2;
  const lcgMultiplier = 1_664_525;
  const lcgIncrement = 1_013_904_223;
  let state = seed;
  const next = (maximum) => {
    state = (Math.imul(state, lcgMultiplier) + lcgIncrement) >>> 0;
    return state % maximum;
  };
  for (const initial of inputs) {
    assert.equal(parse(initial).hasError, false);
    for (let history = 0; history < historiesPerInput; history++) {
      let source = initial;
      const edits = [];
      const undo = [];
      for (let step = 0; step < editsBeforeRestore; step++) {
        const boundaries = [0];
        let offset = 0;
        for (const character of source) {
          offset += Buffer.byteLength(character);
          boundaries.push(offset);
        }
        const index = next(boundaries.length);
        const byte = boundaries[index];
        const end =
          boundaries[
            Math.min(
              index + next(maxDeletedCharacters + 1),
              boundaries.length - 1,
            )
          ];
        const insert = insertions[next(insertions.length)];
        undo.unshift({
          byte,
          deleteBytes: Buffer.byteLength(insert),
          insert: Buffer.from(source).subarray(byte, end).toString(),
        });
        const edit = { byte, deleteBytes: end - byte, insert };
        source = applyEdits(source, [edit]).toString();
        edits.push(edit);
        assertIncrementalEqualsFresh(initial, edits, source);
      }
      for (const edit of undo) {
        source = applyEdits(source, [edit]).toString();
        edits.push(edit);
        assertIncrementalEqualsFresh(initial, edits, source);
      }
      assert.equal(source, initial, `history ${history}`);
    }
  }
});
