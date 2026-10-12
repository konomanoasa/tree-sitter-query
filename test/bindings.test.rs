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
fn node_designators_follow_public_query_api_syntax() {
  let language = grammar::LANGUAGE.into();
  let mut parser = parser();
  for (source, valid) in [
    ("(_ @x)", false),
    ("(_+ _)", false),
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
fn call_placement_and_arguments_follow_public_query_api_syntax() {
  let language = grammar::LANGUAGE.into();
  let mut parser = parser();
  for (source, valid) in [
    ("(#custom?)", true),
    ("[(#custom?)]", true),
    ("((#custom?))", true),
    ("(node_pattern (#custom?))", true),
    ("(#custom? 42 -1 0.5 _ MISSING)", true),
    ("(#_call? _arg)", true),
    ("(_) @_cap (#_call? _arg @_cap)", true),
    ("(#custom)", false),
    ("(#custom?) @capture", false),
    ("(#custom!)?", false),
    ("(# custom?)", false),
    ("(#custom ?)", false),
    ("(identifier) @ name", false),
  ] {
    match Query::new(&language, source) {
      Ok(_) => assert!(valid, "{source:?}"),
      Err(error) => {
        assert!(!valid, "{source:?}: {error:?}");
        assert_eq!(error.kind, QueryErrorKind::Syntax, "{source:?}");
      }
    }
    assert_eq!(
      parser.parse(source, None).unwrap().root_node().has_error(),
      !valid,
      "{source:?}"
    );
  }
}

#[test]
fn documented_call_prefix_overrides_the_public_query_api_extension() {
  let language = grammar::LANGUAGE.into();
  let mut parser = parser();
  for (source, valid) in [
    ("(#custom?)", true),
    ("(#custom! key value)", true),
    ("(.custom?)", false),
    ("(.custom! key value)", false),
  ] {
    assert!(Query::new(&language, source).is_ok(), "{source:?}");
    assert_eq!(
      parser.parse(source, None).unwrap().root_node().has_error(),
      !valid,
      "{source:?}"
    );
  }
}

#[test]
fn postfix_order_and_repetition_follow_public_query_api_syntax() {
  let language = grammar::LANGUAGE.into();
  let mut parser = parser();
  for source in ["(identifier) @x? @y+", "(identifier) +*?"] {
    let query = Query::new(&language, source).unwrap();
    assert_eq!(query.pattern_count(), 1, "{source:?}");
    let tree = parser.parse(source, None).unwrap();
    assert!(!tree.root_node().has_error(), "{source:?}");
    assert_eq!(tree.root_node().named_child_count(), 1, "{source:?}");
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
fn underscored_names_reach_semantic_validation_without_wildcard_splitting() {
  let language = grammar::LANGUAGE.into();
  let mut parser = parser();
  for (source, error) in [
    ("(_x)", QueryErrorKind::NodeType),
    ("(_ !_x)", QueryErrorKind::Field),
    ("(node_pattern !_)", QueryErrorKind::Field),
  ] {
    assert_eq!(
      Query::new(&language, source).unwrap_err().kind,
      error,
      "{source:?}"
    );
    let tree = parser.parse(source, None).unwrap();
    assert!(!tree.root_node().has_error(), "{source:?}");
    assert_eq!(tree.root_node().byte_range(), 0..source.len());
  }
}

#[test]
fn field_lookup_matches_cursor_ownership() {
  let mut parser = parser();
  for source in ["left: right: (_)+ @x", "(node . child: (_)+ @x !absent)"] {
    let tree = parser.parse(source, None).unwrap();
    let mut pending = vec![tree.root_node()];
    let mut fields = 0;
    while let Some(owner) = pending.pop() {
      let mut cursor = owner.walk();
      if !cursor.goto_first_child() {
        continue;
      }
      loop {
        let child = cursor.node();
        if let Some(field) = cursor.field_name() {
          assert_eq!(
            owner.child_by_field_name(field),
            Some(child),
            "{source:?}: {field}"
          );
          assert_eq!(child.parent(), Some(owner));
          fields += 1;
        }
        pending.push(child);
        if !cursor.goto_next_sibling() {
          break;
        }
      }
    }
    assert!(fields > 0, "{source:?}: no fields");
  }
}

#[test]
fn string_arguments_follow_public_query_api_syntax() {
  let language = grammar::LANGUAGE.into();
  let mut parser = parser();
  for source in [
    "\"日\\\"本\"",
    "\";x\0\"",
    "\"\\\n;x\0\"",
    "\"a\0b\0\0c\"",
    "\"\0\"",
    "\"a\\\0b\"",
    "\"\\\0\"",
    r#""\q""#,
    "\"\r\"",
  ] {
    assert!(Query::new(&language, &format!("(#custom? {source})")).is_ok());
    assert!(
      !parser.parse(source, None).unwrap().root_node().has_error(),
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
fn comments_with_carriage_returns_follow_public_query_api_syntax() {
  let language = grammar::LANGUAGE.into();
  let mut parser = parser();
  for (source, patterns) in [(";a\rb\r\n(_)", 1), (";x\r(_)", 0)] {
    let query = Query::new(&language, source).unwrap();
    assert_eq!(query.pattern_count(), patterns, "{source:?}");
    let tree = parser.parse(source, None).unwrap();
    assert!(!tree.root_node().has_error(), "{source:?}");
  }
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
fn bom_at_an_included_range_start_is_not_a_source_bom() {
  let mut parser = parser();
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
