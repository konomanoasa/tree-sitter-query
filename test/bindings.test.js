import assert from "node:assert/strict";
import { test } from "node:test";
import QUERY from "@konomanoasa/tree-sitter-query";
import Parser from "tree-sitter";

test("Node.js language parses query patterns and exposes node metadata", () => {
  const parser = new Parser();
  parser.setLanguage(QUERY);
  const source = "; hello\n(identifier) @name\n";
  const tree = parser.parse(source);
  assert.equal(tree.rootNode.type, "query");
  assert.equal(tree.rootNode.hasError, false);
  assert.equal(tree.rootNode.text, source);
  assert.ok(
    QUERY.nodeTypeInfo.some((node) => node.type === "query" && node.named),
  );
});

test("Node.js packaged highlights capture query comments", () => {
  const parser = new Parser();
  parser.setLanguage(QUERY);
  const tree = parser.parse("; hello\n");
  const query = new Parser.Query(QUERY, QUERY.HIGHLIGHTS_QUERY);
  assert.deepEqual(
    query.captures(tree.rootNode).map(({ name, node }) => [name, node.text]),
    [["comment", "; hello"]],
  );
});
