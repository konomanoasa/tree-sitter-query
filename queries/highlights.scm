(identifier) @type

(string_content) @string

(escape_sequence) @string.escape

(comment) @comment

[
  "("
  ")"
  "["
  "]"
] @punctuation.bracket

[
  "\""
  ":"
  "/"
] @punctuation.delimiter

[
  "@"
  "#"
] @punctuation.special

(wildcard) @character.special

[
  (quantifier)
  (anchor)
] @operator

(missing_node
  "MISSING" @keyword)

(field_constraint
  name: (identifier) @property)

(negated_field
  "!" @operator
  name: (identifier) @property)

(capture
  name: (identifier) @variable)

(predicate
  name: (identifier) @function.call
  "?" @punctuation.special)

(directive
  name: (identifier) @function.call
  "!" @punctuation.special)

(predicate
  argument: (identifier) @string)

(directive
  argument: (identifier) @string)
