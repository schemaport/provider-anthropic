# Anthropic compatibility rules

Every rule `check()` implements, with the official documentation it comes from.
Rules reviewed **2026-08-20**. Sources: [sources.md](sources.md).

Each diagnostic carries a stable `code`, a `path` built with `joinPath`, a
`docsUrl`, and a `compile` ability describing what `compile()` does about it.

---

## Errors

### `anthropic/invalid-tool-name`

- **Path:** `name`
- **Compile:** not supported — compilation is refused.

The Define tools page states: `name` — "Must match the regex
`^[a-zA-Z0-9_-]{1,64}$`". Canonical tool names are broader than that
(`@schemaport/core` allows up to 128 characters and any non-whitespace), so
names such as `billing.refund_order` pass canonical validation and are rejected
by Anthropic.

SchemaPort refuses rather than renaming. A tool name is the identifier your
dispatch code matches on; silently rewriting it would move the breakage from
compile time to runtime. Rename the tool in the source schema.

### `anthropic/input-schema-not-object`

- **Path:** `inputSchema.type`
- **Compile:** not supported — compilation is refused.

The Messages API types `input_schema.type` as the literal `"object"`
(`@anthropic-ai/sdk` 0.119.0, `Anthropic.Tool.InputSchema`). A root schema
declaring any other type cannot be sent. Rewriting the root type would change
what arguments the tool takes, so this is refused rather than compiled.

### `anthropic/missing-input-schema-type`

- **Path:** `inputSchema.type`
- **Compile:** supported, not lossy — adds `"type": "object"`.

A root schema with no `type` at all. The API requires the field, and for a tool
input schema `"object"` is the only legal value, so adding it changes nothing
about which arguments are accepted. The transformation is recorded as
`added-input-schema-type` and the error is dropped from the compile result.

---

## Warnings

Every warning below is a case where Anthropic **accepts** the schema and
**does not enforce** it. Nothing is dropped from the compiled output.

### `anthropic/schema-not-enforced`

- **Path:** `inputSchema`
- **Compile:** supported, not lossy.

The headline rule. The default Messages API tool-use path performs no input
validation. The Define tools page shows the constructed system prompt —
"Here are the functions available in JSONSchema format:
`{{ TOOL DEFINITIONS IN JSON SCHEMA }}`" — the schema is *prompt text*. The
Strict tool use page is explicit about the consequence: "Without strict mode,
Claude might return incompatible types (`"2"` instead of `2`) or omit required
fields, breaking your functions and causing runtime errors."

Emitted whenever the root schema declares at least one property or at least one
required property. A tool that constrains nothing does not get this warning.

### `anthropic/constraint-not-enforced`

- **Path:** the keyword, e.g. `inputSchema.properties.amount.minimum`
- **Compile:** supported, not lossy — the keyword is preserved verbatim.

Keywords on Anthropic's documented "Not supported" list for structured outputs
and strict tool use. These are never enforced: ignored in default tool use, and
a 400 error if you enable `strict: true`.

| Keyword | Documented as |
|---|---|
| `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf` | "Numerical constraints (such as `minimum`, `maximum`, `multipleOf`)" |
| `minLength`, `maxLength` | "String constraints (`minLength`, `maxLength`)" |
| `maxItems`, `uniqueItems` | "Array constraints beyond `minItems` of 0 or 1" |
| `minItems` with a value other than `0` or `1` | "Array `minItems` (only values 0 and 1 supported)" |
| `additionalProperties` set to anything other than `false` | "`additionalProperties` set to anything other than `false`" |

`minItems: 0`, `minItems: 1` and `additionalProperties: false` are inside the
documented subset and are not flagged by this rule — they are still unenforced
in the default form, which `anthropic/schema-not-enforced` already reports.

### `anthropic/keyword-not-documented`

- **Path:** the keyword
- **Compile:** supported, not lossy — the keyword is preserved verbatim.

Keywords that appear in **neither** the supported nor the unsupported list:
`oneOf`, `not`, `prefixItems`, `minProperties`, `maxProperties`, `pattern`.

Absence from a list is not a documented rejection, so this rule deliberately
says "not documented as supported" rather than "will be rejected". SchemaPort
will not invent a guarantee in either direction.

`pattern` is the most interesting case. It is on neither list, but the Strict
tool use data-retention note says "Do not include PHI in `input_schema`
property names, `enum` values, `const` values, or `pattern` regular
expressions", which implies `pattern` is compiled into the grammar under strict
mode. That is suggestive, not a support statement, so it is reported as
uncertain.

`anyOf` and `allOf` **are** documented as supported and are not flagged.

### `anthropic/undocumented-string-format`

- **Path:** `…​.format`
- **Compile:** supported, not lossy.

The documented format set is `date-time`, `time`, `date`, `duration`, `email`,
`hostname`, `uri`, `ipv4`, `ipv6`, `uuid`. Any other value (`iri`,
`json-pointer`, a custom format, …) is outside it and is only ever prompt text.

### `anthropic/enum-non-primitive-value`

- **Path:** `…​.enum`
- **Compile:** supported, not lossy.

Documented: "`enum` (strings, numbers, bools, or nulls only - no complex
types)". An enum containing an object or array is outside that.

### `anthropic/external-ref`

- **Path:** `…​.$ref`
- **Compile:** supported, not lossy — the reference is preserved as written.

Documented: "External `$ref` (for example, `'$ref': 'http://...'`)" is not
supported. Any `$ref` not starting with `#` is treated as external. Nothing
resolves it in the default form either, so the model only ever sees an
unresolved reference string.

Local `$ref`, `$defs` and `definitions` are documented as supported and are not
flagged.

---

## Info

### `anthropic/missing-tool-description`

- **Path:** `description`
- **Compile:** supported — the optional `description` field is simply omitted.

The Define tools page calls the description "by far the most important factor in
tool performance" and recommends "at least 3–4 sentences for each tool
description". A missing description is legal but costs accuracy.
