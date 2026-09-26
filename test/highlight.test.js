import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createTreeSitter, packageName, root } from "../scripts/tree-sitter.js";

function decodeEntities(text) {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

function renderedCaptures(html, source) {
  const start = html.indexOf("<pre><code>");
  const end = html.indexOf("</code></pre>");
  assert.ok(start >= 0 && end >= start, html);
  const content = html.slice(start + "<pre><code>".length, end);
  const stack = [];
  const captures = [];
  let text = "";
  for (const part of content.matchAll(
    /<span class='([^']*)'>|<[/]span>|([^<]+)/g,
  )) {
    if (part[1] !== undefined) stack.push(part[1].replaceAll(" ", "."));
    else if (part[0] === "</span>") assert.notEqual(stack.pop(), undefined);
    else {
      const decoded = decodeEntities(part[2]);
      text += decoded;
      captures.push(
        ...Array(Buffer.byteLength(decoded)).fill(stack.at(-1) ?? ""),
      );
    }
  }
  assert.equal(stack.length, 0, "unclosed highlight span");
  assert.equal(
    text.replace(/\n$/, ""),
    source.replace(/\n$/, ""),
    "rendered source differs from the input",
  );
  return captures;
}

function createHighlighter({ directory, root, run, captureNames }) {
  const parserDirectory = join(directory, "parsers");
  mkdirSync(parserDirectory);
  // CLI discovery requires a tree-sitter-* entry even when the checkout is renamed.
  symlinkSync(root, join(parserDirectory, "tree-sitter-test"), "junction");
  const configPath = join(directory, "highlight.json");
  const capturePath = join(directory, "captures.txt");
  writeFileSync(
    configPath,
    JSON.stringify({
      "parser-directories": [parserDirectory],
      theme: Object.fromEntries(
        captureNames.map((name, index) => [name, index + 17]),
      ),
    }),
  );
  writeFileSync(capturePath, `${captureNames.join("\n")}\n`);

  return (scope, source, valid = true) => {
    const path = join(directory, "highlight.txt");
    writeFileSync(path, source);
    if (valid) {
      const parsed = run(["parse", "--cst", "--scope", scope, path]);
      assert.doesNotMatch(parsed, /^[0-9: \t-]+•/m, parsed);
    }
    const captures = renderedCaptures(
      run([
        "highlight",
        "--check",
        "--captures-path",
        capturePath,
        "--config-path",
        configPath,
        "--html",
        "--layout",
        "fragment",
        "--style",
        "classes",
        "--scope",
        scope,
        path,
      ]),
      source,
    );
    for (const capture of captures) {
      assert.ok(
        capture === "" || captureNames.includes(capture),
        `unexpected final capture: ${capture}`,
      );
    }
    return captures;
  };
}

function assertCaptures(source, actual, ranges) {
  const bytes = Buffer.from(source);
  const expected = Array(bytes.length).fill("");
  let previousEnd = 0;
  for (const [start, end, capture] of ranges) {
    assert.ok(
      Number.isSafeInteger(start) && start >= previousEnd,
      "expected ranges must be ordered and disjoint",
    );
    assert.ok(
      Number.isSafeInteger(end) && end > start && end <= bytes.length,
      "expected range exceeds source bytes",
    );
    expected.fill(capture, start, end);
    previousEnd = end;
  }
  // HTML emits line breaks outside spans.
  for (const [index, byte] of bytes.entries()) {
    if (byte !== 10)
      assert.equal(
        actual[index],
        expected[index],
        `byte ${index} in ${JSON.stringify(source)}`,
      );
  }
}

const captureNames = [
  "type",
  "property",
  "variable",
  "function.call",
  "operator",
  "keyword",
  "punctuation.bracket",
  "punctuation.delimiter",
  "punctuation.special",
  "string",
  "string.escape",
  "comment",
  "character.special",
];
let highlight;

let directory;
let runner;
before(() => {
  directory = mkdtempSync(join(tmpdir(), `${packageName}-highlight-`));
  runner = createTreeSitter();
  highlight = createHighlighter({
    directory,
    root,
    run: assertCommand,
    captureNames,
  });
});
after(() => {
  try {
    runner?.close();
  } finally {
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

function assertCommand(arguments_) {
  const result = runner.run(arguments_, {
    timeout: 60_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stderr, /Non-standard highlight captures/);
  return result.stdout;
}

const finalCaptureCases = [
  {
    name: "node fields, both wildcards and capture names",
    source: "(node field: (_) @variable.builtin !type _)\n",
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 5, "type"],
      [6, 11, "property"],
      [11, 12, "punctuation.delimiter"],
      [13, 14, "punctuation.bracket"],
      [14, 15, "character.special"],
      [15, 16, "punctuation.bracket"],
      [17, 18, "punctuation.special"],
      [18, 34, "variable"],
      [35, 36, "operator"],
      [36, 40, "property"],
      [41, 42, "character.special"],
      [42, 43, "punctuation.bracket"],
    ],
  },
  {
    name: "chained field constraints inside an alternation",
    source: "[outer: inner: (node) @x]\n",
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 6, "property"],
      [6, 7, "punctuation.delimiter"],
      [8, 13, "property"],
      [13, 14, "punctuation.delimiter"],
      [15, 16, "punctuation.bracket"],
      [16, 20, "type"],
      [20, 21, "punctuation.bracket"],
      [22, 23, "punctuation.special"],
      [23, 24, "variable"],
      [24, 25, "punctuation.bracket"],
    ],
  },
  {
    name: "anchor before a call without child patterns",
    source: "(node . (#custom?))\n",
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 5, "type"],
      [6, 7, "operator"],
      [8, 9, "punctuation.bracket"],
      [9, 10, "punctuation.special"],
      [10, 16, "function.call"],
      [16, 17, "punctuation.special"],
      [17, 18, "punctuation.bracket"],
      [18, 19, "punctuation.bracket"],
    ],
  },
  {
    name: "anchors, quantifiers and group delimiters",
    source: "((node . [(child)+]? .))\n",
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 2, "punctuation.bracket"],
      [2, 6, "type"],
      [7, 8, "operator"],
      [9, 10, "punctuation.bracket"],
      [10, 11, "punctuation.bracket"],
      [11, 16, "type"],
      [16, 17, "punctuation.bracket"],
      [17, 18, "operator"],
      [18, 19, "punctuation.bracket"],
      [19, 20, "operator"],
      [21, 22, "operator"],
      [22, 23, "punctuation.bracket"],
      [23, 24, "punctuation.bracket"],
    ],
  },
  {
    name: "supertype and MISSING marker",
    source: '(expression/"()") (MISSING identifier)\n',
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 11, "type"],
      [11, 12, "punctuation.delimiter"],
      [12, 13, "punctuation.delimiter"],
      [13, 15, "string"],
      [15, 16, "punctuation.delimiter"],
      [16, 17, "punctuation.bracket"],
      [18, 19, "punctuation.bracket"],
      [19, 26, "keyword"],
      [27, 37, "type"],
      [37, 38, "punctuation.bracket"],
    ],
  },
  {
    name: "predicate arguments and escaped text",
    source: '(#custom? @comment "日\\";@#<&amp;>" local)\n',
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 2, "punctuation.special"],
      [2, 8, "function.call"],
      [8, 9, "punctuation.special"],
      [10, 11, "punctuation.special"],
      [11, 18, "variable"],
      [19, 20, "punctuation.delimiter"],
      [20, 23, "string"],
      [23, 25, "string.escape"],
      [25, 35, "string"],
      [35, 36, "punctuation.delimiter"],
      [37, 42, "string"],
      [42, 43, "punctuation.bracket"],
    ],
  },
  {
    name: "NUL content and escaped NUL keep string classifications",
    source: '"a\u0000b\\\u0000c"\n',
    captures: [
      [0, 1, "punctuation.delimiter"],
      [1, 4, "string"],
      [4, 6, "string.escape"],
      [6, 7, "string"],
      [7, 8, "punctuation.delimiter"],
    ],
  },
  {
    name: "keyword spelling and prefixes keep their owning name roles",
    source: "(MISSINGx MISSING: (_) @MISSING (#MISSING? MISSING))\n",
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 9, "type"],
      [10, 17, "property"],
      [17, 18, "punctuation.delimiter"],
      [19, 20, "punctuation.bracket"],
      [20, 21, "character.special"],
      [21, 22, "punctuation.bracket"],
      [23, 24, "punctuation.special"],
      [24, 31, "variable"],
      [32, 33, "punctuation.bracket"],
      [33, 34, "punctuation.special"],
      [34, 41, "function.call"],
      [41, 42, "punctuation.special"],
      [43, 50, "string"],
      [50, 51, "punctuation.bracket"],
      [51, 52, "punctuation.bracket"],
    ],
  },
  {
    name: "special token spelling in field, supertype and missing type names",
    source: "(MISSING _ _field: _) (MISSING type/_) (_/MISSING) (MISSING _)\n",
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 8, "keyword"],
      [9, 10, "type"],
      [11, 12, "character.special"],
      [12, 17, "property"],
      [17, 18, "punctuation.delimiter"],
      [19, 20, "character.special"],
      [20, 21, "punctuation.bracket"],
      [22, 23, "punctuation.bracket"],
      [23, 30, "keyword"],
      [31, 35, "type"],
      [35, 36, "punctuation.delimiter"],
      [36, 37, "type"],
      [37, 38, "punctuation.bracket"],
      [39, 40, "punctuation.bracket"],
      [40, 41, "type"],
      [41, 42, "punctuation.delimiter"],
      [42, 49, "type"],
      [49, 50, "punctuation.bracket"],
      [51, 52, "punctuation.bracket"],
      [52, 59, "keyword"],
      [60, 61, "type"],
      [61, 62, "punctuation.bracket"],
    ],
  },
  {
    name: "directive markers and dotted arguments",
    source: '(#set! injection.language "query") ; @ignored\n',
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 2, "punctuation.special"],
      [2, 5, "function.call"],
      [5, 6, "punctuation.special"],
      [7, 25, "string"],
      [26, 27, "punctuation.delimiter"],
      [27, 32, "string"],
      [32, 33, "punctuation.delimiter"],
      [33, 34, "punctuation.bracket"],
      [35, 45, "comment"],
    ],
  },
];

for (const { name, source, captures } of finalCaptureCases) {
  test(`query: ${name}`, () => {
    const actual = highlight("source.query", source, false);
    assertCaptures(source, actual, captures);
    assert.equal(actual.length, Buffer.byteLength(source) - 1);
  });
}

test("query: invalid and incomplete source keeps its text without diagnostic captures", () => {
  for (const source of ["(ERROR) @\n", '((node) (#eq? "unfinished\n', ")]\n"]) {
    const actual = highlight("source.query", source, false);
    assert.equal(actual.length, Buffer.byteLength(source) - 1);
    assert.ok(
      actual.every(
        (capture) => capture === "" || captureNames.includes(capture),
      ),
    );
  }
});
