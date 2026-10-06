use konomanoasa_tree_sitter_query as grammar;
use tree_sitter::{
  Parser, Point, Query, QueryCursor, QueryErrorKind, Range, StreamingIterator,
};

fn parser() -> Parser {
  let mut parser = Parser::new();
  parser.set_language(&grammar::LANGUAGE.into()).unwrap();
  parser
}

#[test]
fn parses_valid_source() {
  let source = "(identifier) @name\n";
  let language = grammar::LANGUAGE.into();
  let mut parser = Parser::new();
  parser.set_language(&language).unwrap();
  let tree = parser.parse(source, None).unwrap();
  let root = tree.root_node();
  assert_eq!(root.kind(), "query");
  assert_eq!(root.byte_range(), 0..source.len());
  assert!(!root.has_error());
  assert!(grammar::NODE_TYPES.contains("\"query\""));
  Query::new(&language, grammar::HIGHLIGHTS_QUERY).unwrap();
}

#[test]
fn preserves_comment_text() {
  let mut parser = parser();
  let source = "; query\n";
  let tree = parser.parse(source, None).unwrap();
  let root = tree.root_node();
  assert!(!root.has_error());
  assert_eq!(root.kind(), "query");
  assert_eq!(root.to_sexp(), "(query (comment))");
  assert_eq!(root.named_child(0).unwrap().byte_range(), 0..7);
}

#[test]
fn missing_node_forms_follow_public_query_api_syntax() {
  let language = grammar::LANGUAGE.into();
  let mut parser = parser();
  for (source, valid) in [
    ("(MISSING)", true),
    ("(MISSING ; comment\n)", true),
    ("(MISSING identifier)", true),
    ("(MISSING pattern body: (_))", true),
    ("(MISSING (_))", false),
    ("(MISSING . (_))", false),
    ("(MISSING !body)", false),
    ("(MISSING (#custom?))", false),
    ("(MISSING identifier: (_))", false),
    ("(MISSING \"(\" @x)", false),
    ("(MISSING/identifier)", false),
  ] {
    let query = Query::new(&language, source);
    if valid {
      assert!(query.is_ok(), "{source:?}: {query:?}");
    } else {
      assert_eq!(
        query.unwrap_err().kind,
        QueryErrorKind::Syntax,
        "{source:?}"
      );
    }
    let tree = parser.parse(source, None).unwrap();
    assert_eq!(tree.root_node().has_error(), !valid, "{source:?}");
  }
}

#[test]
fn field_constraints_and_call_anchors_follow_public_query_api_syntax() {
  let language = grammar::LANGUAGE.into();
  let mut parser = parser();
  for (source, valid) in [
    ("(node_pattern . !node (pattern))", false),
    ("(node_pattern !node . (pattern))", true),
    ("(node_pattern (pattern) . !node)", false),
    ("(node_pattern (pattern) !node .)", true),
    ("(node_pattern _: (_))", false),
    ("body: (node_pattern)", true),
    ("((identifier) subtype: (identifier))", true),
    ("[(identifier) node: (identifier)]", true),
    ("node: node: (identifier)", true),
    ("(node_pattern node: node: (identifier))", true),
    ("(node_pattern . (#custom?))", true),
    ("(node_pattern . (#custom!))", true),
    ("(node_pattern (#custom?) .)", false),
    ("(node_pattern (#custom!) .)", false),
    ("(node_pattern ((#custom?)) .)", false),
    ("(node_pattern [(#custom?)] .)", false),
    ("(node_pattern [((#custom?))] .)", false),
    ("(node_pattern ((#custom?) (pattern)?) .)", true),
    ("(node_pattern [(#custom?) (pattern)] .)", true),
    ("(node_pattern (pattern) ((#custom?)) .)", true),
    ("(node_pattern . (#custom?) !node)", true),
    ("(node_pattern . (#custom?) . (pattern))", true),
    ("(node_pattern (pattern) . (#custom?) .)", true),
    ("((#custom?) . (identifier))", true),
    ("((identifier) . (#custom?))", true),
    ("((#custom?) . (#other?))", true),
  ] {
    let query = Query::new(&language, source);
    if valid {
      assert!(query.is_ok(), "{source:?}: {query:?}");
    } else {
      assert_eq!(
        query.unwrap_err().kind,
        QueryErrorKind::Syntax,
        "{source:?}"
      );
    }
    assert_eq!(
      parser.parse(source, None).unwrap().root_node().has_error(),
      !valid,
      "{source:?}"
    );
  }

  let source = "(capture name: body: (node_pattern))";
  assert_eq!(
    Query::new(&language, source).unwrap_err().kind,
    QueryErrorKind::Structure
  );
  assert!(!parser.parse(source, None).unwrap().root_node().has_error());
}

#[test]
fn adjacent_bare_wildcards_follow_public_query_api_pattern_and_capture_counts()
{
  let language = grammar::LANGUAGE.into();
  let mut parser = parser();
  let target = "(x) (y)";
  let tree = parser.parse(target, None).unwrap();
  for (source, expected_patterns, expected_captures) in [
    ("__ @hit", 2, 11),
    ("_ _ @hit", 2, 11),
    ("_body: (node_pattern) @hit", 2, 2),
    ("_ body: (node_pattern) @hit", 2, 2),
  ] {
    let query = Query::new(&language, source).unwrap();
    assert_eq!(query.pattern_count(), expected_patterns, "{source:?}");
    let mut cursor = QueryCursor::new();
    let mut matches =
      cursor.matches(&query, tree.root_node(), target.as_bytes());
    let mut captures = 0;
    while let Some(item) = matches.next() {
      for capture in item.captures() {
        assert_eq!(item.pattern_index, 1, "{source:?}");
        assert_eq!(query.capture_names()[capture.index as usize], "hit");
        captures += 1;
      }
    }
    assert_eq!(captures, expected_captures, "{source:?}");
    let syntax = parser.parse(source, None).unwrap();
    assert!(!syntax.root_node().has_error(), "{source:?}");
    assert_eq!(syntax.root_node().named_child_count(), expected_patterns);
  }
}

#[test]
fn bare_wildcards_split_field_prefixes_but_identifier_contexts_preserve_ranges()
{
  let language = grammar::LANGUAGE.into();
  let query = Query::new(&language, "[(wildcard) (identifier)] @leaf").unwrap();
  let mut parser = parser();
  for (source, expected) in [
    (
      "__ @x",
      vec![("wildcard", 0..1), ("wildcard", 1..2), ("identifier", 4..5)],
    ),
    (
      "_field: (x)",
      vec![
        ("wildcard", 0..1),
        ("identifier", 1..6),
        ("identifier", 9..10),
      ],
    ),
    (
      "(_x !_field) @_cap",
      vec![
        ("identifier", 1..3),
        ("identifier", 5..11),
        ("identifier", 14..18),
      ],
    ),
    (
      "(#_call? _arg @_cap)",
      vec![
        ("identifier", 2..7),
        ("identifier", 9..13),
        ("identifier", 15..19),
      ],
    ),
    (
      "(MISSING _type) (_super/_sub)",
      vec![
        ("identifier", 9..14),
        ("identifier", 17..23),
        ("identifier", 24..28),
      ],
    ),
  ] {
    let tree = parser.parse(source, None).unwrap();
    assert!(!tree.root_node().has_error(), "{source:?}");
    let mut cursor = QueryCursor::new();
    let mut matches =
      cursor.matches(&query, tree.root_node(), source.as_bytes());
    let mut actual = Vec::new();
    while let Some(item) = matches.next() {
      let node = item.captures()[0].node;
      assert_eq!(node.child_count(), 0);
      actual.push((node.kind(), node.byte_range()));
    }
    assert_eq!(actual, expected, "{source:?}");
  }
}

#[test]
fn chained_fields_preserve_names_separators_and_postfix_ranges() {
  let tree = parser().parse("left: right: (_)+ @x", None).unwrap();
  let root = tree.root_node();
  assert!(!root.has_error());
  assert_eq!(root.named_child_count(), 1);
  let mut target = root.named_child(0).unwrap();
  for (range, name_range, separator_range) in
    [(0..20, 0..4, 4..5), (6..20, 6..11, 11..12)]
  {
    assert_eq!(target.kind(), "field_constraint");
    assert_eq!(target.byte_range(), range);
    assert_eq!(target.child_count(), 3);
    assert_eq!(
      target.child_by_field_name("name").unwrap().byte_range(),
      name_range
    );
    let separator = target.child(1).unwrap();
    assert_eq!(separator.kind(), ":");
    assert!(!separator.is_named());
    assert_eq!(separator.byte_range(), separator_range);
    target = target.child_by_field_name("pattern").unwrap();
  }
  assert_eq!(target.kind(), "pattern");
  assert_eq!(target.byte_range(), 13..20);
  for (field, kind, range) in [
    ("body", "node_pattern", 13..16),
    ("quantifier", "quantifier", 16..17),
    ("capture", "capture", 18..20),
  ] {
    let child = target.child_by_field_name(field).unwrap();
    assert_eq!(child.kind(), kind);
    assert_eq!(child.byte_range(), range);
  }
}

#[test]
fn string_leaves_preserve_literal_bytes_and_escape_spelling() {
  let language = grammar::LANGUAGE.into();
  let mut parser = parser();
  for (source, expected) in [
    (
      "\"日\\\"本\"",
      vec![
        ("\"", 0..1),
        ("string_content", 1..4),
        ("escape_sequence", 4..6),
        ("string_content", 6..9),
        ("\"", 9..10),
      ],
    ),
    (
      "\";x\0\"",
      vec![("\"", 0..1), ("string_content", 1..4), ("\"", 4..5)],
    ),
    (
      "\"\\\n;x\0\"",
      vec![
        ("\"", 0..1),
        ("escape_sequence", 1..3),
        ("string_content", 3..6),
        ("\"", 6..7),
      ],
    ),
    (
      "\"a\0b\0\0c\"",
      vec![("\"", 0..1), ("string_content", 1..7), ("\"", 7..8)],
    ),
    (
      "\"\0\"",
      vec![("\"", 0..1), ("string_content", 1..2), ("\"", 2..3)],
    ),
    (
      "\"a\\\0b\"",
      vec![
        ("\"", 0..1),
        ("string_content", 1..2),
        ("escape_sequence", 2..4),
        ("string_content", 4..5),
        ("\"", 5..6),
      ],
    ),
    (
      "\"\\\0\"",
      vec![("\"", 0..1), ("escape_sequence", 1..3), ("\"", 3..4)],
    ),
  ] {
    assert!(Query::new(&language, &format!("(#custom? {source})")).is_ok());
    let tree = parser.parse(source, None).unwrap();
    assert!(!tree.root_node().has_error(), "{source:?}");
    let string = tree
      .root_node()
      .named_child(0)
      .unwrap()
      .child_by_field_name("body")
      .unwrap();
    let mut cursor = string.walk();
    let actual: Vec<_> = string
      .children(&mut cursor)
      .map(|node| {
        assert_eq!(node.child_count(), 0);
        (node.kind(), node.byte_range())
      })
      .collect();
    assert_eq!(actual, expected, "{source:?}");
  }
  for source in ["\"a\0", "\"\\\0", "\"a\\", "\"\0\n\""] {
    assert!(
      parser.parse(source, None).unwrap().root_node().has_error(),
      "{source:?}"
    );
  }
}

#[test]
fn string_newlines_cannot_skip_comments_before_nul() {
  let language = grammar::LANGUAGE.into();
  let mut parser = parser();
  for (source, api_error) in [
    ("\"\n;x\0\"", QueryErrorKind::Syntax),
    ("(#custom? \"\n;x\0\")", QueryErrorKind::Syntax),
    ("(#custom! \"\n;x\0\")", QueryErrorKind::Syntax),
    ("(identifier/\"\n;x\0\")", QueryErrorKind::Structure),
  ] {
    assert_eq!(
      Query::new(&language, source).unwrap_err().kind,
      api_error,
      "{source:?}"
    );
    let tree = parser.parse(source, None).unwrap();
    assert!(tree.root_node().has_error(), "{source:?}");
    assert_eq!(tree.root_node().byte_range(), 0..source.len());
  }
}

#[test]
fn carriage_returns_inside_comments_preserve_the_following_pattern() {
  let language = grammar::LANGUAGE.into();
  let mut parser = parser();
  let source = ";a\rb\r\n(_)";
  assert!(Query::new(&language, source).is_ok());
  let tree = parser.parse(source, None).unwrap();
  let root = tree.root_node();
  assert!(!root.has_error());
  assert_eq!(
    root.to_sexp(),
    "(query (comment) (pattern body: (node_pattern node: (wildcard))))"
  );
  assert_eq!(root.named_child(0).unwrap().byte_range(), 0..4);
  assert_eq!(root.named_child(1).unwrap().byte_range(), 6..9);
}

#[test]
fn highlight_captures_use_leaf_ranges_even_during_recovery() {
  let language = grammar::LANGUAGE.into();
  let query = Query::new(&language, grammar::HIGHLIGHTS_QUERY).unwrap();
  let mut parser = parser();
  for (source, has_error) in [
    ("(node field: (_) @name)", false),
    ("((node . child: (_)+ @x !absent) . [(other)* _?])", false),
    (
      "(MISSING) (MISSING identifier) (MISSING \";\") (ERROR)",
      false,
    ),
    ("(expression/call) (expression/\"()\")", false),
    ("(node _field: (_) !_) (_/node) (MISSING type/node)", false),
    ("(MISSING node field: (_)) (MISSING _ MISSING: (_))", false),
    ("left: right: (node)+ @x [field: (_)]", false),
    ("((#first?) . body: (node . (#check?)) . (#last!))", false),
    ("(node _: (_))", true),
    ("(node . !field (child))", true),
    ("(MISSING _) (MISSING MISSING)", false),
    ("(#custom? \"a\0b\\\0c\")", false),
    (
      "((node) @x (#custom? @x \"日\\\"本\" local) (#set! key value)) ; text",
      false,
    ),
    ("(node) @", true),
    ("(node", true),
    ("(#eq? @x \"unfinished", true),
    (")]", true),
  ] {
    let tree = parser.parse(source, None).unwrap();
    assert_eq!(tree.root_node().has_error(), has_error, "{source:?}");
    let mut cursor = QueryCursor::new();
    let mut matches =
      cursor.matches(&query, tree.root_node(), source.as_bytes());
    let mut count = 0;
    while let Some(item) = matches.next() {
      for capture in item.captures() {
        count += 1;
        assert_eq!(
          capture.node.child_count(),
          0,
          "{source:?}: {}",
          capture.node.kind()
        );
        assert!(capture.node.end_byte() <= source.len());
        if capture.node.is_missing() {
          assert!(capture.node.byte_range().is_empty());
        }
      }
    }
    assert!(count > 0, "{source:?}: no highlight captures");
  }
}

#[test]
fn public_children_preserve_fields_delimiters_and_source_order() {
  let source = "(node . child: (_)+ @x !absent)";
  let tree = parser().parse(source, None).unwrap();
  assert!(!tree.root_node().has_error());
  let mut cursor = tree.walk();
  let mut depth = 0;
  let mut actual = Vec::new();
  'walk: loop {
    let node = cursor.node();
    actual.push((
      depth,
      node.kind(),
      cursor.field_name(),
      node.is_named(),
      node.byte_range(),
    ));
    assert_eq!(
      node.start_position(),
      Point {
        row: 0,
        column: node.start_byte()
      }
    );
    assert_eq!(
      node.end_position(),
      Point {
        row: 0,
        column: node.end_byte()
      }
    );
    if cursor.goto_first_child() {
      depth += 1;
      continue;
    }
    while !cursor.goto_next_sibling() {
      if !cursor.goto_parent() {
        break 'walk;
      }
      depth -= 1;
    }
  }
  assert_eq!(
    actual,
    vec![
      (0, "query", None, true, 0..31),
      (1, "pattern", None, true, 0..31),
      (2, "node_pattern", Some("body"), true, 0..31),
      (3, "(", None, false, 0..1),
      (3, "identifier", Some("node"), true, 1..5),
      (3, "anchor", None, true, 6..7),
      (3, "field_constraint", None, true, 8..22),
      (4, "identifier", Some("name"), true, 8..13),
      (4, ":", None, false, 13..14),
      (4, "pattern", Some("pattern"), true, 15..22),
      (5, "node_pattern", Some("body"), true, 15..18),
      (6, "(", None, false, 15..16),
      (6, "wildcard", Some("node"), true, 16..17),
      (6, ")", None, false, 17..18),
      (5, "quantifier", Some("quantifier"), true, 18..19),
      (5, "capture", Some("capture"), true, 20..22),
      (6, "@", None, false, 20..21),
      (6, "identifier", Some("name"), true, 21..22),
      (3, "negated_field", None, true, 23..30),
      (4, "!", None, false, 23..24),
      (4, "identifier", Some("name"), true, 24..30),
      (3, ")", None, false, 30..31),
    ]
  );
}

#[test]
fn bom_is_ignored_only_once_at_source_byte_zero() {
  let mut parser = parser();
  let source = "\u{feff}(node)\r\n";
  let tree = parser.parse(source, None).unwrap();
  assert!(!tree.root_node().has_error());
  let pattern = tree.root_node().named_child(0).unwrap();
  assert_eq!(pattern.byte_range(), 3..9);
  assert_eq!(pattern.start_position(), Point { row: 0, column: 3 });
  assert_eq!(tree.root_node().end_position(), Point { row: 1, column: 0 });
  for invalid in [
    " \u{feff}(node)",
    "\u{feff}\u{feff}(node)",
    "(node)\u{feff}",
  ] {
    assert!(
      parser.parse(invalid, None).unwrap().root_node().has_error(),
      "{invalid:?}"
    );
  }
  let embedded = "x\u{feff}(node)";
  parser
    .set_included_ranges(&[Range {
      start_byte: 1,
      end_byte: embedded.len(),
      start_point: Point { row: 0, column: 1 },
      end_point: Point {
        row: 0,
        column: embedded.len(),
      },
    }])
    .unwrap();
  assert!(
    parser
      .parse(embedded, None)
      .unwrap()
      .root_node()
      .has_error()
  );
}

#[test]
fn crlf_and_multibyte_comment_ranges_keep_source_coordinates() {
  let mut parser = parser();
  let source = "; 日\r\n(node)";
  let tree = parser.parse(source, None).unwrap();
  let root = tree.root_node();
  assert!(!root.has_error());
  let comment = root.named_child(0).unwrap();
  assert_eq!(comment.byte_range(), 0..5);
  assert_eq!(comment.end_position(), Point { row: 0, column: 5 });
  let pattern = root.named_child(1).unwrap();
  assert_eq!(pattern.byte_range(), 7..13);
  assert_eq!(pattern.start_position(), Point { row: 1, column: 0 });
}
