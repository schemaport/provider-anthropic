# Transformations

Every change `compile()` makes to a canonical tool, with its lossy
classification. Reviewed **2026-08-20**.

SchemaPort classifies a transformation as `lossy: true` only when the compiled
schema accepts inputs the canonical schema rejects, because a keyword was
dropped or weakened. **This provider emits no lossy transformations at all.**

## `renamed-input-schema-field`

- **Path:** `inputSchema`
- **Lossy:** `false`
- **Emitted:** always.

The canonical field `inputSchema` is emitted as the Messages API field
`input_schema`. Confirmed against `@anthropic-ai/sdk` 0.119.0
(`Anthropic.Tool.input_schema`) and the Messages API reference. Renaming a field
changes nothing about the set of accepted argument values.

## `added-input-schema-type`

- **Path:** `inputSchema.type`
- **Lossy:** `false`
- **Emitted:** only when the canonical root schema declares no `type`.

Adds `"type": "object"`. The Messages API requires the field and only accepts
`"object"` for a tool input schema, so a root schema that omitted it was already
an object in practice. No constraint is dropped or weakened.

Pairs with the `anthropic/missing-input-schema-type` error, which
`finalizeCompile` then drops from the result because compile worked around it.

---

## Why there are no lossy transformations

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
is no keyword the default request path rejects, so there is no keyword this
package needs to drop.

`compile()` therefore never removes `minimum`, `pattern`, `oneOf`,
`additionalProperties`, `format`, `$ref` or anything else. It also never
truncates enums or collapses unions.

The corresponding honesty cost is paid in `check()`: preserving a keyword in
the payload is not the same as the provider honouring it. See
[limitations.md](limitations.md).

## What compile refuses

Two conditions produce `ok: false` regardless of `allowLossy`, because the
Messages API would reject the request and no non-destructive fix exists:

- `anthropic/invalid-tool-name` — the tool name is outside `^[a-zA-Z0-9_-]{1,64}$`.
- `anthropic/input-schema-not-object` — the root schema declares a non-object type.

`--allow-lossy` has no effect on this provider's output. Because no
transformation is lossy, `compile(tool)` and `compile(tool, { allowLossy: true })`
produce byte-identical results; the test suite asserts this for every shared
fixture.
