# Transformations

Every change `compile()` makes to a canonical tool, with its lossy
classification. Reviewed **2026-08-20**.

SchemaPort classifies a transformation as `lossy: true` only when the compiled
schema accepts inputs the canonical schema rejects, because a keyword was
dropped or weakened.

**The default compilation emits no lossy transformation at all.**
`compile(tool)` preserves every keyword. Every lossy transformation on this page
belongs to `compile(tool, { strict: true })`, which is opt-in: strict mode is
the only thing that makes this provider drop anything.

## Transformations emitted in both modes

### `renamed-input-schema-field`

- **Path:** `inputSchema`
- **Lossy:** `false`
- **Emitted:** always.

The canonical field `inputSchema` is emitted as the Messages API field
`input_schema`. Confirmed against `@anthropic-ai/sdk` 0.119.0
(`Anthropic.Tool.input_schema`) and the Messages API reference. Renaming a field
changes nothing about the set of accepted argument values.

### `added-input-schema-type`

- **Path:** `inputSchema.type`
- **Lossy:** `false`
- **Emitted:** only when the canonical root schema declares no `type`.

Adds `"type": "object"`. The Messages API requires the field and only accepts
`"object"` for a tool input schema, so a root schema that omitted it was already
an object in practice. No constraint is dropped or weakened.

Pairs with the `anthropic/missing-input-schema-type` error, which
`finalizeCompile` then drops from the result because compile worked around it.

---

## Strict-mode transformations

Emitted only by `compile(tool, { strict: true })`.

### `enabled-strict-mode`

- **Path:** `inputSchema`
- **Lossy:** `false`
- **Emitted:** always, under `strict: true`.

Adds `strict: true` to the tool definition. The SDK documents the field as
"When true, guarantees schema validation on tool names and inputs". Turning on
enforcement drops no constraint; the drops below are what pay for it.

### `dropped-numeric-constraint`

- **Path:** the keyword, e.g. `inputSchema.properties.amount.minimum`
- **Lossy:** **`true`**
- **Emitted:** per occurrence of `minimum`, `maximum`, `exclusiveMinimum`,
  `exclusiveMaximum`, `multipleOf`.

The strict subset lists "Numerical constraints (such as `minimum`, `maximum`,
`multipleOf`)" as not supported and returns a 400. The keyword has to go, and
the compiled schema then accepts values the canonical schema rejects — the
textbook lossy transformation.

### `dropped-string-constraint`

- **Path:** the keyword
- **Lossy:** **`true`**
- **Emitted:** per occurrence of `minLength`, `maxLength`.

"String constraints (`minLength`, `maxLength`)" are not supported.

### `dropped-array-constraint`

- **Path:** the keyword
- **Lossy:** **`true`**
- **Emitted:** per occurrence of `maxItems`, `uniqueItems`, or `minItems` with a
  value other than `0` or `1`.

"Array constraints beyond `minItems` of 0 or 1" are not supported. `minItems: 0`
and `minItems: 1` survive untouched.

### `dropped-additional-properties-schema`

- **Path:** `….additionalProperties`
- **Lossy:** **`true`**
- **Emitted:** when `additionalProperties` holds a schema.

"`additionalProperties` set to anything other than `false`" is not supported, so
a typed map such as `{ "additionalProperties": { "type": "string" } }` becomes
`{ "additionalProperties": false }`. The object no longer accepts the keys the
canonical schema described, and there is no way to express the map under strict
mode. Classified the same way the OpenAI provider classifies the identical
rewrite.

### `closed-open-object`

- **Path:** `….additionalProperties`
- **Lossy:** `false`
- **Emitted:** when `additionalProperties` is `true`.

Replaced with `false`, for the same documented reason. No canonical constraint
stops being enforced — the schema gets *stricter* — so the lossy gate does not
apply. It still changes what the model may send, which is why
`anthropic/strict-closed-open-object` warns about it and that warning survives
into the result.

### `added-additional-properties-false`

- **Path:** `….additionalProperties`
- **Lossy:** `false`
- **Emitted:** for every object schema that declared no `additionalProperties`.

The strict subset requires the field on every object. A canonical schema that
said nothing about extra keys was already closed in practice, so nothing it
accepted is lost.

### `required-every-property`

- **Path:** `….required`
- **Lossy:** `false`
- **Emitted:** once per object that has at least one property missing from
  `required`.

The strict subset has no documented way to express an optional property, so
strict compilation lists every declared property in `required`. The compiled
schema is *narrower* than the canonical one, not wider, so the lossy gate —
which exists to catch schemas getting weaker — does not fire. That is a
deliberate and slightly uncomfortable line: this is a real behavioural change,
gated by nothing, and it is reported by the surviving warning
`anthropic/strict-always-present-property`. Read that before shipping a strict
tool.

Unlike every other transformation on this page, this one is **not** backed by a
quoted line of Anthropic documentation. The reviewed pages document
`additionalProperties: false` as a strict-subset object requirement and say
nothing about optional properties. SchemaPort applies the rule anyway and labels
it as its own choice rather than inventing a citation — see
[sources.md](sources.md).

---

## Why the default form drops nothing

Anthropic's `input_schema` is an open JSON Schema object. The SDK types it as:

```ts
interface InputSchema {
  type: 'object';
  properties?: unknown | null;
  required?: Array<string> | null;
  [k: string]: unknown;
}
```

and the Define tools page shows the schema being rendered into the constructed
tool-use system prompt verbatim (`{{ TOOL DEFINITIONS IN JSON SCHEMA }}`). There
is no keyword the default request path rejects, so there is no keyword the
default compilation needs to drop.

`compile(tool)` therefore never removes `minimum`, `pattern`, `oneOf`,
`additionalProperties`, `format`, `$ref` or anything else. It also never
truncates enums or collapses unions.

The corresponding honesty cost is paid in `check()`: preserving a keyword in
the payload is not the same as the provider honouring it. See
[limitations.md](limitations.md).

Strict mode inverts that bargain — Anthropic honours what survives, and what the
documented subset rejects does not survive. What strict mode still does **not**
drop: `pattern`, `oneOf`, `not`, `prefixItems`, `minProperties`,
`maxProperties`, non-primitive `enum` members, undocumented `format` values and
external `$ref`. None of those is on a documented rejection list, so dropping
them would be a guess; they are kept and flagged as uncertain.

## What compile refuses

Two conditions produce `ok: false` regardless of `allowLossy` **or** `strict`,
because the Messages API would reject the request and no non-destructive fix
exists:

- `anthropic/invalid-tool-name` — the tool name is outside `^[a-zA-Z0-9_-]{1,64}$`.
- `anthropic/input-schema-not-object` — the root schema declares a non-object type.

A third condition applies only under `strict: true`: any schema carrying a
keyword the strict subset rejects produces a lossy transformation, and
`finalizeCompile` refuses it unless the caller passes `allowLossy`. Five of the
six shared fixtures land here — `ping` is the only one that does not.

`--allow-lossy` still has no effect on the **default** output. Because no
default transformation is lossy, `compile(tool)` and
`compile(tool, { allowLossy: true })` produce byte-identical results; the test
suite asserts this for every shared fixture, and separately asserts that the
default output is byte-identical to what this package produced before strict
mode existed.

## Which transformations each mode can emit

| Transformation | Default | `strict: true` | Lossy |
|---|---|---|---|
| `renamed-input-schema-field` | always | always | no |
| `added-input-schema-type` | when the root has no `type` | when the root has no `type` | no |
| `enabled-strict-mode` | never | always | no |
| `dropped-numeric-constraint` | never | per keyword | **yes** |
| `dropped-string-constraint` | never | per keyword | **yes** |
| `dropped-array-constraint` | never | per keyword | **yes** |
| `dropped-additional-properties-schema` | never | per typed map | **yes** |
| `closed-open-object` | never | per `additionalProperties: true` | no |
| `added-additional-properties-false` | never | per object | no |
| `required-every-property` | never | per object with optional properties | no |
