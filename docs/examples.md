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

## A refused compile

A tool name that is legal canonically but illegal for Anthropic:

```ts
{ name: 'billing.refund_order', inputSchema: { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] } }
```

`compile()` returns `ok: false` with no `output`, and the diagnostic

```
error anthropic/invalid-tool-name  name
```

`--allow-lossy` does not change this: the fix is to rename the tool, not to
weaken the schema.

## Using the compiled output

```ts
import Anthropic from '@anthropic-ai/sdk';
import { anthropicProvider } from '@schemaport/provider-anthropic';

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
