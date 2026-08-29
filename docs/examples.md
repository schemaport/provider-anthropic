# Examples

Worked against the shared fixtures from `@schemaport/core`. Every output below
is the real result produced by this package.

## A tool that compiles clean

`minimalTool` constrains nothing, so no enforcement warning applies.

```ts
{ name: 'ping', inputSchema: { type: 'object', properties: {} } }
```

`compile().output`:

```json
{ "name": "ping", "input_schema": { "type": "object", "properties": {} } }
```

Diagnostics: one `info` — `anthropic/missing-tool-description`. No warnings.

It is also the one shared fixture that compiles strictly with no `allowLossy`.
`compile(minimalTool, { strict: true }).output`:

```json
{
  "name": "ping",
  "input_schema": { "type": "object", "properties": {}, "additionalProperties": false },
  "strict": true
}
```

## The PRD example

`refundOrderTool` — one required property, one optional property with a
`minimum`.

`compile().output`:

```json
{
  "name": "refund_order",
  "description": "Refunds all or part of an order",
  "input_schema": {
    "type": "object",
    "properties": {
      "orderId": { "type": "string", "description": "The order to refund" },
      "amount": {
        "type": "number",
        "minimum": 0,
        "description": "Amount to refund. Omit to refund the full order."
      }
    },
    "required": ["orderId"]
  }
}
```

`ok: true`, no `--allow-lossy` needed. Transformations:
`renamed-input-schema-field` (`lossy: false`). Diagnostics kept in the result:

```
warning anthropic/schema-not-enforced        inputSchema
warning anthropic/constraint-not-enforced    inputSchema.properties.amount.minimum
```

Note that the optional `amount` stays optional and `minimum: 0` stays in the
payload. Nothing was weakened in the document — but Anthropic will not reject a
call with `amount: -5`, which is what the second warning says.

## The same example, compiled strictly

`compile(refundOrderTool, { strict: true })` is **refused**:

```
ok: false
error core/lossy-transformation-refused  inputSchema
  Compiling for anthropic would weaken this schema:
  dropped-numeric-constraint at inputSchema.properties.amount.minimum.
  Re-run with --allow-lossy to accept the weaker output.
```

`minimum: 0` cannot survive the strict subset, dropping it is lossy, and lossy
compiles are refused. Adding `allowLossy` compiles it —
`compile(refundOrderTool, { strict: true, allowLossy: true }).output`:

```json
{
  "name": "refund_order",
  "description": "Refunds all or part of an order",
  "input_schema": {
    "type": "object",
    "properties": {
      "orderId": { "type": "string", "description": "The order to refund" },
      "amount": {
        "type": "number",
        "description": "Amount to refund. Omit to refund the full order."
      }
    },
    "required": ["orderId", "amount"],
    "additionalProperties": false
  },
  "strict": true
}
```

Transformations:

```
safe   renamed-input-schema-field         inputSchema
safe   enabled-strict-mode                inputSchema
LOSSY  dropped-numeric-constraint         inputSchema.properties.amount.minimum
safe   required-every-property            inputSchema.required
safe   added-additional-properties-false  inputSchema.additionalProperties
```

Diagnostics kept in the result:

```
warning anthropic/strict-always-present-property  inputSchema.properties.amount
```

Read the two outputs side by side and the trade is the whole story. The default
form keeps `minimum: 0` and leaves `amount` optional, and Anthropic enforces
neither. The strict form has Anthropic enforcing the types and the required
list — and `amount` is now mandatory and unbounded, so a call with
`amount: -5` is valid. Neither output is *better*; they fail differently, and
that is what you are choosing between.

## A constraint-heavy tool

`constraintTool` compiles with every keyword intact:

```json
{
  "name": "schedule_job",
  "description": "Schedules a background job",
  "input_schema": {
    "type": "object",
    "properties": {
      "jobId": { "type": "string", "pattern": "^job_[a-z0-9]+$", "minLength": 5 },
      "runEvery": { "type": "integer", "minimum": 60, "maximum": 86400, "multipleOf": 60 },
      "window": { "type": "array", "items": { "type": "string" }, "minItems": 2, "maxItems": 2 }
    },
    "required": ["jobId", "runEvery"]
  }
}
```

Diagnostics:

```
warning anthropic/schema-not-enforced      inputSchema
warning anthropic/constraint-not-enforced  inputSchema.properties.jobId.minLength
warning anthropic/keyword-not-documented   inputSchema.properties.jobId.pattern
warning anthropic/constraint-not-enforced  inputSchema.properties.runEvery.maximum
warning anthropic/constraint-not-enforced  inputSchema.properties.runEvery.minimum
warning anthropic/constraint-not-enforced  inputSchema.properties.runEvery.multipleOf
warning anthropic/constraint-not-enforced  inputSchema.properties.window.maxItems
warning anthropic/constraint-not-enforced  inputSchema.properties.window.minItems
```

Eight warnings, zero lossy transformations, `ok: true`. `window.minItems` is
flagged because its value is `2`; `minItems` of `0` or `1` would not be.

Strictly, `compile(constraintTool, { strict: true, allowLossy: true }).output`
keeps very little:

```json
{
  "name": "schedule_job",
  "description": "Schedules a background job",
  "input_schema": {
    "type": "object",
    "properties": {
      "jobId": { "type": "string", "pattern": "^job_[a-z0-9]+$" },
      "runEvery": { "type": "integer" },
      "window": { "type": "array", "items": { "type": "string" } }
    },
    "required": ["jobId", "runEvery", "window"],
    "additionalProperties": false
  },
  "strict": true
}
```

Six lossy drops — `jobId.minLength`, `runEvery.minimum`, `runEvery.maximum`,
`runEvery.multipleOf`, `window.minItems`, `window.maxItems` — and two
diagnostics:

```
warning anthropic/strict-keyword-undocumented     inputSchema.properties.jobId.pattern
warning anthropic/strict-always-present-property  inputSchema.properties.window
```

`pattern` survives: it is on neither documented list, so SchemaPort keeps it and
tells you it cannot promise the request will be accepted. This is the tool where
strict mode is a bad trade — almost everything `schedule_job` actually constrains
lives in the keywords the strict subset rejects.

## An open string map

`openMapTool` keeps its typed `additionalProperties` — unlike targets that
require closed objects, nothing is erased:

```json
{
  "name": "tag_resource",
  "description": "Attaches arbitrary string tags to a resource",
  "input_schema": {
    "type": "object",
    "properties": {
      "resourceId": { "type": "string" },
      "tags": { "type": "object", "additionalProperties": { "type": "string" } }
    },
    "required": ["resourceId", "tags"]
  }
}
```

```
warning anthropic/schema-not-enforced      inputSchema
warning anthropic/constraint-not-enforced  inputSchema.properties.tags.additionalProperties
```

Strictly, the map cannot be expressed at all.
`compile(openMapTool, { strict: true })` is refused; with `allowLossy` the
`tags` object survives as an object that accepts nothing at all:

```json
{
  "tags": { "type": "object", "additionalProperties": false }
}
```

recorded as `dropped-additional-properties-schema` (`lossy: true`). If your tool
takes an open map, the default form is the only one that can describe it.

## A refused compile

A tool name that is legal canonically but illegal for Anthropic:

```ts
{ name: 'billing.refund_order', inputSchema: { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] } }
```

`compile()` returns `ok: false` with no `output`, and the diagnostic

```
error anthropic/invalid-tool-name  name
```

`--allow-lossy` does not change this, and neither does `strict`: the fix is to
rename the tool, not to weaken the schema.

## Compiling every shared fixture, both ways

| Fixture | `compile(tool)` | `compile(tool, { strict: true })` | Why |
|---|---|---|---|
| `ping` | ok | **ok** | constrains nothing |
| `refund_order` | ok | refused | `amount.minimum` |
| `create_ticket` | ok | refused | `minLength`, `maxLength`, `minimum`, `maximum`, `maxItems` |
| `tag_resource` | ok | refused | typed `additionalProperties` |
| `set_limit` | ok | refused | `minimum` inside an `anyOf` branch |
| `schedule_job` | ok | refused | `minLength`, `minimum`, `maximum`, `multipleOf`, `minItems`, `maxItems` |

All six compile strictly with `allowLossy: true`. `ping` is the only tool for
which strict mode is free — which is a fair summary of the trade-off: strict
mode costs you exactly as much as your schema constrains.

## Using the compiled output

```ts
import Anthropic from '@anthropic-ai/sdk';
import { anthropicProvider } from '@schemaport/provider-anthropic';

// Add `{ strict: true, allowLossy: true }` to get the enforced form instead.
const compiled = anthropicProvider.compile(refundOrderTool);
if (!compiled.ok) throw new Error('incompatible tool');

const client = new Anthropic();
const message = await client.messages.create({
  model: 'claude-opus-5',
  max_tokens: 1024,
  tools: [compiled.output],
  messages: [{ role: 'user', content: 'Refund order ord_123 in full.' }],
});
```
