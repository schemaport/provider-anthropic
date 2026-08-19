# Known limitations

Reviewed **2026-08-20** against the sources in [sources.md](sources.md).

## Accepted is not enforced

This is the single most important thing to understand about the Anthropic
target, and the reason a compatible tool still reports warnings.

The Messages API accepts arbitrary JSON Schema in `input_schema` and renders it
into the tool-use system prompt. It performs no validation of the model's tool
inputs in the default configuration. Anthropic states this directly on the
Strict tool use page:

> Without strict mode, Claude might return incompatible types (`"2"` instead of
> `2`) or omit required fields, breaking your functions and causing runtime
> errors.

So for a tool compiled by this package:

| | Sent to Anthropic | Enforced by Anthropic |
|---|---|---|
| `type` | yes | no |
| `required` | yes | no |
| `enum`, `const` | yes | no |
| `minimum`, `maxLength`, `pattern`, … | yes | no |

`check()` reports this as `anthropic/schema-not-enforced` on every tool whose
root schema declares at least one property or required property. It is a
warning, not a clean pass.

## SchemaPort does not emit `strict: true`

Setting `strict: true` on a tool definition is the only way Anthropic enforces
the schema — it constrains sampling to schema-valid output. This package does
not emit it, deliberately.

The strict subset **rejects with a 400** every keyword in the
`anthropic/constraint-not-enforced` table: numerical constraints (`minimum`,
`maximum`, `multipleOf`), string constraints (`minLength`, `maxLength`), array
constraints beyond `minItems` of 0 or 1, and `additionalProperties` set to
anything other than `false`. Emitting a strict tool definition would mean
dropping those keywords from the schema, which is a lossy transformation under
SchemaPort's rules — and would make the PRD's own `refund_order` example
(`amount` has `minimum: 0`) refuse to compile without `--allow-lossy`.

The trade is therefore explicit rather than hidden: SchemaPort compiles to the
permissive form that carries the whole schema, and reports in `check()` that
none of it is enforced. If you want enforcement for a specific tool, take the
compiled output, remove the keywords the strict subset rejects, add
`additionalProperties: false` to every object, and add `strict: true` yourself —
knowing exactly which constraints you gave up.

There is no option on this package to do that for you. Adding one would need a
provider-specific compile option, which the shared `CompileOptions` contract
does not have.

## `pattern` support is genuinely unclear

`pattern` appears in neither the supported nor the unsupported list of the JSON
Schema limitations page. The Strict tool use data-retention note warns against
putting PHI in "`pattern` regular expressions", which implies it is compiled
into the grammar under strict mode — but that is an inference, not a support
statement. Reported as `anthropic/keyword-not-documented` rather than assumed to
work in either direction.

## Rules derived from absence

`oneOf`, `not`, `prefixItems`, `minProperties` and `maxProperties` are also
absent from both lists. The page says "If you use an unsupported feature, you'll
receive a 400 error with details", but joining that to "absent from the
supported list" is a two-step inference. These are reported as "not documented
as supported", not as rejections.

**Union `type` arrays** (`"type": ["string", "null"]`) are also absent from both
lists. They are passed through untouched and are *not* flagged. Anthropic's
`enum` support explicitly includes nulls and `anyOf` is documented as supported,
so a type array is not obviously outside the subset — but neither is it
documented as inside it. No rule is emitted rather than guessing; the
tool-level `anthropic/schema-not-enforced` warning still applies.

## Not implemented

Behaviour this package deliberately does not model, because the documentation
does not support a rule:

- **Recursive schema detection.** Recursive schemas are documented as
  unsupported under strict mode, which this package does not emit. No rule.
- **Description or schema size limits.** Neither the Messages API reference nor
  the Tool reference documents a maximum description length, a maximum
  `input_schema` size, or a maximum number of tools. No rule.
- **Per-model differences.** Strict tool use lists supported models; the default
  tool-use path this package targets is available across current models, so no
  model-specific rule is applied.
- **`$defs` inlining.** Local `$ref`/`$defs` are documented as supported and are
  passed through untouched.
- **`input_examples`, `cache_control`, `defer_loading`, `allowed_callers`.**
  These optional tool-definition properties are outside SchemaPort's canonical
  format and are never emitted.

## Probe limitations

- The probe answers "was this tool definition accepted?", not "does the model
  respect the schema?" — one sampled call is not evidence about enforcement.
- A response truncated at `max_tokens` carries a partially written tool input.
  Those arguments are **not** inspected, because reporting them would be
  indistinguishable from a real schema violation. The result is `accepted` with
  a note.
- Argument validation uses `@schemaport/core`'s `validateValue`, which does not
  resolve `$ref` and does not check `format`.
- The probe sends `tool_choice: { type: 'tool', name: … }` so that a call is
  always produced. Core's `classifyProviderError` maps any 400/422 that does not
  mention a missing model to `rejected`, so a 400 caused by the *forced tool
  choice* rather than the schema — for example a model that does not support
  forced tool use — would be reported as a schema rejection. Cross-check a
  `rejected` verdict's `providerError.message` before acting on it.
