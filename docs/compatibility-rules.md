# Anthropic compatibility rules

Every rule `check()` implements, with the official documentation it comes from.
Rules reviewed **2026-08-20**. Sources: [sources.md](sources.md).

Each diagnostic carries a stable `code`, a `path` built with `joinPath`, a
`docsUrl`, and a `compile` ability describing what `compile()` does about it.

## Two rule sets, one per mode

The two compilation modes are genuinely different targets, so the rules split
along that line:

```ts
anthropicProvider.check(tool);                   // rules for the default tool definition
anthropicProvider.check(tool, { strict: true }); // rules for `strict: true`
```

`compile()` passes its own mode through, so the diagnostics in a compile result
always describe the definition that compile actually produced.

- **Shared rules** apply in both modes: the tool name, the root type, the
  description, `enum` values, `format`, and external `$ref`. Under `strict: true`
  the last three add one sentence noting the request may come back as a 400.
- **Default-only rules:** `anthropic/schema-not-enforced`,
  `anthropic/constraint-not-enforced`, `anthropic/keyword-not-documented`. All
  three describe a keyword being carried but not honoured, which is not what
  happens under strict mode.
- **Strict-only rules:** everything prefixed `anthropic/strict-`. None of them
  is ever emitted when strict is off.

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
compile time to runtime. Rename the tool in the source schema. `allowLossy` and
`strict` make no difference to this.

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
**does not enforce** it. Nothing is dropped from the compiled output. Three of
them — `schema-not-enforced`, `constraint-not-enforced` and
`keyword-not-documented` — describe the *default* compilation only, and are
replaced by the strict-mode rules further down when `strict: true` is set.

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
required property. A tool that constrains nothing does not get this warning, and
neither does a strict check — under `strict: true` Anthropic does validate the
inputs, so the warning would be false.

### `anthropic/constraint-not-enforced`

- **Path:** the keyword, e.g. `inputSchema.properties.amount.minimum`
- **Compile:** supported, not lossy — the keyword is preserved verbatim.

Keywords on Anthropic's documented "Not supported" list for structured outputs
and strict tool use. These are never enforced: ignored in default tool use, and
a 400 error if you enable `strict: true`.

This rule is about the default form, where the keyword is *kept and ignored*.
Under `strict: true` the keyword is *dropped*, which is a different fact with a
different cost, and is reported by the `anthropic/strict-drops-…` rules instead.

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
will not invent a guarantee in either direction. Under `strict: true` the same
keywords are reported by `anthropic/strict-keyword-undocumented`, which says the
request may be rejected — still not a promise in either direction. They are
never dropped.

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

---

## Strict-mode rules

These fire **only** for `check(tool, { strict: true })` and
`compile(tool, { strict: true })`. All but two are derived from the
"Not supported" list in [limitations.md](limitations.md#strict-true-is-available-and-it-costs-constraints).
The exceptions are `anthropic/strict-keyword-undocumented` and
`anthropic/strict-local-ref`, which report *uncertainty* rather than a rule, and
`anthropic/strict-always-present-property`, whose source is a choice this
package makes rather than a page it can cite — each says so in its own message.

Rules backed by a documented rejection follow SchemaPort's two-diagnostic
pattern where it applies: an `error` saying the canonical schema cannot be sent
as written, which `finalizeCompile` drops once compile has worked around it,
and — for changes that are *not* gated by `allowLossy` — a `warning` recording
what changed at runtime, which survives into the compile result. Rules backed by
uncertainty are warnings only, because an error would assert a rejection nobody
documented.

### `anthropic/strict-drops-numeric-constraint`

- **Severity:** error
- **Path:** the keyword, e.g. `inputSchema.properties.amount.minimum`
- **Compile:** supported, **lossy** — the keyword is dropped.

`minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`.
Documented as "Numerical constraints (such as `minimum`, `maximum`,
`multipleOf`)" under "Not supported", and "If you use an unsupported feature,
you'll receive a 400 error with details".

### `anthropic/strict-drops-string-constraint`

- **Severity:** error
- **Path:** the keyword
- **Compile:** supported, **lossy** — the keyword is dropped.

`minLength`, `maxLength`. Documented as "String constraints (`minLength`,
`maxLength`)".

### `anthropic/strict-drops-array-constraint`

- **Severity:** error
- **Path:** the keyword
- **Compile:** supported, **lossy** — the keyword is dropped.

`maxItems`, `uniqueItems`, and `minItems` with any value other than `0` or `1`.
Documented as "Array constraints beyond `minItems` of 0 or 1". `minItems: 0` and
`minItems: 1` are inside the subset and are kept.

### `anthropic/strict-drops-additional-properties`

- **Severity:** error
- **Path:** `….additionalProperties`
- **Compile:** supported. **Lossy** when the value is a schema; not lossy when
  it is `true`.

Documented as "`additionalProperties` set to anything other than `false`".
Compile emits `false` either way. Replacing `true` drops no constraint — the
object simply stops accepting undeclared keys — while replacing a *typed* map
destroys a documented capability of the tool, so only the second is gated by
`allowLossy`.

### `anthropic/strict-closed-open-object`

- **Severity:** warning
- **Path:** `….additionalProperties`
- **Compile:** supported, not lossy.

The surviving half of the pair above, for the `additionalProperties: true` case:
after compilation the object rejects undeclared keys that the canonical schema
accepted. Not gated, so it has to be visible in the result.

### `anthropic/strict-always-present-property`

- **Severity:** warning
- **Path:** `inputSchema.properties.<name>`
- **Compile:** supported, not lossy — the property is added to `required`.

Strict compilation lists every declared property in `required`, so after
compilation the model must always send it, and code that treated its absence as
meaningful will see a value instead. This is the change most likely to surprise
a caller, and `allowLossy` does not gate it, because the schema got *stricter*,
not weaker.

**This rule's source is weaker than every other rule in this package, and the
message says so.** The reviewed documentation gives one object requirement for
the strict subset — `additionalProperties: false` — and says nothing about
optional properties. SchemaPort closes `required` anyway, because the subset has
no documented way to express optionality; it does **not** claim Anthropic would
reject the schema otherwise, which is why this is a warning and not an error
paired with one. See [sources.md](sources.md).

### `anthropic/strict-keyword-undocumented`

- **Severity:** warning
- **Path:** the keyword
- **Compile:** supported, not lossy — the keyword is preserved verbatim.

`oneOf`, `not`, `prefixItems`, `minProperties`, `maxProperties`, `pattern` under
`strict: true`. The strict-mode counterpart of
`anthropic/keyword-not-documented`, and it says the honest thing: these appear
on neither documented list, so SchemaPort cannot tell you whether strict mode
honours them, and the request may be rejected with a 400. They are kept rather
than dropped, because dropping a keyword the documentation does not reject would
destroy a constraint for a reason this package cannot cite.

### `anthropic/strict-local-ref`

- **Severity:** warning
- **Path:** `….$ref`
- **Compile:** supported, not lossy — the reference is preserved as written.

Local `$ref` is documented as supported, but recursive schemas are documented as
*un*supported under `strict: true`. SchemaPort does not resolve references, so
it cannot tell the two apart. Rather than claim a recursion check it does not
perform, it warns on every local `$ref` that it cannot confirm the schema is
non-recursive.

---

## Info

### `anthropic/missing-tool-description`

- **Path:** `description`
- **Compile:** supported — the optional `description` field is simply omitted.

The Define tools page calls the description "by far the most important factor in
tool performance" and recommends "at least 3–4 sentences for each tool
description". A missing description is legal but costs accuracy.
