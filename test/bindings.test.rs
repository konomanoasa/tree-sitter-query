use konomanoasa_tree_sitter_query as grammar;
use tree_sitter::{Parser, Query, QueryCursor, StreamingIterator};

#[test]
fn parses_valid_source() {
  let source = "; hello\n(identifier) @name\n";
  let language = grammar::LANGUAGE.into();
  let mut parser = Parser::new();
  parser.set_language(&language).unwrap();
  let tree = parser.parse(source, None).unwrap();
  let root = tree.root_node();
  assert_eq!(root.kind(), "query");
  assert_eq!(root.byte_range(), 0..source.len());
  assert!(!root.has_error());
  assert!(grammar::NODE_TYPES.contains("\"query\""));
  let query = Query::new(&language, grammar::HIGHLIGHTS_QUERY).unwrap();
  let mut cursor = QueryCursor::new();
  let mut captures = cursor.captures(&query, root, source.as_bytes());
  let mut comments = Vec::new();
  while let Some((matched, index)) = captures.next() {
    let capture = matched.captures()[*index];
    if query.capture_names()[capture.index as usize] == "comment" {
      comments.push(&source[capture.node.byte_range()]);
    }
  }
  assert_eq!(comments, ["; hello"]);
}
