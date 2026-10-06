const namePattern = /[A-Za-z0-9_-][A-Za-z0-9_.-]*/;
const stringContent = /[^"\\\n]+/;

const postfixed = ($, body) =>
  seq(
    field("body", body),
    repeat(
      choice(field("capture", $.capture), field("quantifier", $.quantifier)),
    ),
  );

const anchored = ($, member) => seq(optional($.anchor), member);

const fieldConstraint = ($, target) =>
  seq(
    field(
      "name",
      choice(
        alias($._field_identifier, $.identifier),
        alias("MISSING", $.identifier),
      ),
    ),
    ":",
    field("pattern", target),
  );

const subtyped = ($, supertype) =>
  seq(
    field("supertype", supertype),
    token.immediate("/"),
    field(
      "subtype",
      choice(
        alias($._immediate_identifier, $.identifier),
        alias($._immediate_string, $.string),
      ),
    ),
  );

const call = ($, marker) =>
  seq(
    "(",
    "#",
    field("name", alias($._immediate_identifier, $.identifier)),
    token.immediate(marker),
    repeat(field("argument", choice($.capture, $.string, $._name))),
    ")",
  );

export default grammar({
  name: "query",
  extras: ($) => [/[ \t\r\n\v\f]/, $.comment],
  rules: {
    query: ($) => optional($._members),
    _members: ($) => seq($._member, optional($._members)),
    _member: ($) => choice($._child_pattern, $._call),
    _call: ($) => choice($.predicate, $.directive),
    _call_only_member: ($) => choice($._call_only_child_pattern, $._call),

    pattern: ($) => postfixed($, choice($._delimited, $.string, $.wildcard)),
    _call_only_pattern: ($) =>
      postfixed(
        $,
        choice(
          alias($._call_only_group, $.group),
          alias($._call_only_alternation, $.alternation),
        ),
      ),
    _delimited: ($) => choice($.node_pattern, $.group, $.alternation),
    _child_pattern: ($) =>
      choice($._matching_child_pattern, $._call_only_child_pattern),
    _matching_child_pattern: ($) => choice($.pattern, $.field_constraint),
    _call_only_child_pattern: ($) =>
      choice(
        alias($._call_only_pattern, $.pattern),
        alias($._call_only_field_constraint, $.field_constraint),
      ),

    node_pattern: ($) =>
      seq(
        "(",
        choice(
          field("node", alias($._untyped_missing_node, $.missing_node)),
          seq(
            field(
              "node",
              choice($.identifier, $.wildcard, $.supertype, $.missing_node),
            ),
            repeat($._node_annotation),
            optional(
              seq(
                anchored($, $._matching_child_pattern),
                repeat(
                  choice(
                    $._node_annotation,
                    anchored($, $._matching_child_pattern),
                  ),
                ),
                optional($.anchor),
              ),
            ),
          ),
        ),
        ")",
      ),
    _node_annotation: ($) =>
      choice(anchored($, $._call_only_member), $.negated_field),

    field_constraint: ($) => fieldConstraint($, $._matching_child_pattern),
    _call_only_field_constraint: ($) =>
      fieldConstraint($, $._call_only_child_pattern),
    negated_field: ($) => seq("!", field("name", $._name)),

    supertype: ($) =>
      subtyped($, choice($.identifier, alias($.wildcard, $.identifier))),
    _untyped_missing_node: () => "MISSING",
    missing_node: ($) =>
      seq(
        "MISSING",
        field(
          "type",
          choice($._name, $.string, alias($._missing_supertype, $.supertype)),
        ),
      ),
    _missing_supertype: ($) => subtyped($, $._name),

    group: ($) =>
      seq(
        "(",
        choice(
          alias($._group_pattern, $.pattern),
          seq(
            $._call_only_group_start,
            repeat(anchored($, $._call_only_member)),
            anchored($, $._matching_child_pattern),
          ),
        ),
        repeat(anchored($, $._member)),
        ")",
      ),
    _group_pattern: ($) => postfixed($, choice($._delimited, $.string)),
    _call_only_group: ($) =>
      seq(
        "(",
        $._call_only_group_start,
        repeat(anchored($, $._call_only_member)),
        ")",
      ),
    _call_only_group_start: ($) =>
      choice($._call, alias($._call_only_pattern, $.pattern)),

    alternation: ($) =>
      seq(
        "[",
        repeat($._call_only_member),
        $._matching_child_pattern,
        repeat($._member),
        "]",
      ),
    _call_only_alternation: ($) => seq("[", repeat1($._call_only_member), "]"),

    quantifier: () => token(choice("+", "*", "?")),
    anchor: () => ".",
    wildcard: () => "_",
    capture: ($) =>
      seq("@", field("name", alias($._immediate_identifier, $.identifier))),

    predicate: ($) => call($, "?"),
    directive: ($) => call($, "!"),

    identifier: () => namePattern,
    _field_identifier: () => /[A-Za-z0-9-][A-Za-z0-9_.-]*/,
    _immediate_identifier: () => token.immediate(namePattern),
    _name: ($) =>
      choice(
        $.identifier,
        alias($.wildcard, $.identifier),
        alias("MISSING", $.identifier),
      ),

    string: ($) => seq('"', $._string_tail),
    _immediate_string: ($) => seq(token.immediate('"'), $._string_tail),
    _string_tail: ($) =>
      seq(
        repeat(choice($.string_content, $.escape_sequence)),
        choice(token.immediate('"'), seq($._string_line_break, $._unmatchable)),
      ),
    _string_line_break: () => token.immediate(/\n/),
    _unmatchable: () => token(seq("\\", /[^\s\S]/)),
    string_content: () =>
      token.immediate(
        prec(
          1,
          repeat1(choice(stringContent, seq("\0", optional(stringContent)))),
        ),
      ),
    // Keep NUL distinct from EOF in the generated lexer.
    escape_sequence: () => token.immediate(choice(/\\(.|\n)/, prec(1, "\\\0"))),

    comment: () => /;[^\r\n]*(\r+[^\r\n]+)*/,
  },
});
