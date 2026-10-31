import unittest
from types import CapsuleType

import tree_sitter_query

from tree_sitter import Language, Parser, Query, QueryCursor


class BindingsTest(unittest.TestCase):
    def test_language_capsule_parses_source(self):
        capsule = tree_sitter_query.language()
        self.assertIsInstance(capsule, CapsuleType)
        language = Language(capsule)
        self.assertEqual(language.name, "query")
        source = b"(identifier) @name\n"
        tree = Parser(language).parse(source)
        self.assertEqual(tree.root_node.type, "query")
        self.assertFalse(tree.root_node.has_error)
        self.assertEqual(tree.root_node.text, source)

    def test_packaged_highlights_capture_comment(self):
        language = Language(tree_sitter_query.language())
        tree = Parser(language).parse(b"; hello\n")
        query = Query(language, tree_sitter_query.HIGHLIGHTS_QUERY)
        captures = QueryCursor(query).captures(tree.root_node)
        self.assertEqual(
            [node.text for node in captures["comment"]], [b"; hello"]
        )


if __name__ == "__main__":
    unittest.main()
