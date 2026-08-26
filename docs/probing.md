# Probing the Anthropic API

`probe()` sends the compiled tool definition to the Messages API and reports
whether Anthropic accepted it. Reviewed **2026-08-20**.

It never executes your function. It sends one short synthetic user message
asking the model to produce a single placeholder call, and inspects the
arguments.

## Setup

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Then:

```bash
schemaport probe --targets anthropic ./tools/refund_order.json
```

Override the model:

```bash
# per run
schemaport probe --targets anthropic --model claude-sonnet-5 ./tools/refund_order.json

# for the shell session
export SCHEMAPORT_ANTHROPIC_MODEL=claude-sonnet-5
schemaport probe --targets anthropic ./tools/refund_order.json
```

From code:

```ts
import { anthropicProvider } from '@schemaport/provider-anthropic';

// `probe` is optional on `SchemaPortProvider`, so call it with `?.`
// (or import `probeToolWithAnthropic` directly for a non-optional binding).
const result = await anthropicProvider.probe?.(tool, {
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-haiku-4-5',
  timeoutMs: 20_000,
});
```

## Probing the strict form

`probe()` takes the same `strict` option `compile()` does, so you can ask the
more interesting question: does Anthropic accept the tool definition it will
actually validate against?

```ts
const result = await anthropicProvider.probe?.(tool, {
  strict: true,
  allowLossy: true,  // strict compilation is lossy for most real schemas
});
```

Everything the default probe guarantees still holds. In particular **compilation
happens first**: if strict compilation would be refused — because the schema
carries a keyword the strict subset rejects and you did not pass `allowLossy` —
the probe returns `status: 'error'`, `errorKind: 'compile-refused'` and sends
nothing. A schema SchemaPort would not compile is never put on the wire.

Two things make a strict probe worth running:

- A `rejected` verdict is a much stronger signal than in the default mode. The
  default path accepts nearly anything, so a 400 there is rare; the strict
  subset is the one Anthropic actually validates, so a 400 there usually means
  a real keyword problem. The prime suspects are the keywords SchemaPort keeps
  because the documentation does not classify them — `pattern`, `oneOf`, `not`,
  `prefixItems`, `minProperties`, `maxProperties`, union `type` arrays — and a
  recursive `$ref`, which is documented as unsupported under strict mode.
  Read `providerError.message`: it names the offending feature.
- Returned arguments are still validated against the **canonical** schema, not
  the reduced strict one. So `status: 'accepted'` with `argumentsValid: false`
  under strict mode is the cost of strict mode made visible: Anthropic honoured
  the schema it was given, and the constraint it violated is one SchemaPort had
  to drop to get there.

A strict probe against a model that does not support `strict: true` will come
back as `rejected`. SchemaPort does not keep a list of strict-capable models, so
it cannot tell that apart from a schema problem — cross-check
`providerError.message` before concluding the schema is at fault.

## Model selection

| | Value |
|---|---|
| Default model | `claude-haiku-4-5` |
| Environment override | `SCHEMAPORT_ANTHROPIC_MODEL` |
| Option override | `options.model` |

Resolution order is `options.model` → `SCHEMAPORT_ANTHROPIC_MODEL` → default,
via `resolveProbeModel` from `@schemaport/core`.

The default comes from the official
[Models overview](https://platform.claude.com/docs/en/about-claude/models/overview)
"Latest models comparison" table: Claude Haiku 4.5 is the cheapest currently
available model at $1 / input MTok and $5 / output MTok, and it supports tool
use. `claude-haiku-4-5` is the documented alias for
`claude-haiku-4-5-20251001`.

## What is sent

| Field | Value |
|---|---|
| `model` | resolved as above |
| `max_tokens` | `1024` — required by the Messages API; kept small |
| `messages` | one user turn from `probePrompt(tool)` |
| `tools` | `[compile(tool, { strict }).output]` — carries `strict: true` only when asked |
| `tool_choice` | `{ type: 'tool', name: <tool name> }`, so a call is produced |

No real data is ever sent. `probePrompt` asks for placeholder values and says
the call will not be executed.

## Results

| Outcome | `status` | `errorKind` |
|---|---|---|
| Tool definition accepted | `accepted` | — |
| Anthropic returned 400/422 on the request body | `rejected` | — |
| No API key found | `error` | `missing-credentials` |
| 401 / 403 | `error` | `authentication` |
| 404 (unknown model) | `error` | `model-not-found` |
| 429 | `error` | `rate-limit` |
| Connection failure, timeout, 5xx | `error` | `network` |
| Compilation was refused, nothing sent | `error` | `compile-refused` |

`compile-refused` covers the strict case too: `probe(tool, { strict: true })`
without `allowLossy` refuses before any request is made, for any schema carrying
a keyword the strict subset rejects.

Only `rejected` means Anthropic refused the schema. Everything else is an
environment problem and is reported as such — a stale model id never shows up as
a bad schema.

On acceptance, any returned tool-call arguments are validated against the
**canonical** input schema, not the compiled one. That is what makes Anthropic's
lack of default enforcement observable: `status: 'accepted'` with
`argumentsValid: false` means the API took the schema and the model ignored part
of it.

Two responses are treated as accepted with no arguments inspected:

- `stop_reason: 'max_tokens'` — the tool input may be half-written, and
  reporting a truncated object would look identical to a genuine violation.
- `stop_reason: 'refusal'` — the model declined; the schema was still accepted.

## Testing

`options.client` is a test seam. When supplied, the adapter uses it and never
constructs an SDK client or reads `ANTHROPIC_API_KEY`. It only needs a
`messages.create(body, options?)`:

```ts
const client = {
  messages: {
    create: async (body) => ({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', name: 'refund_order', input: { orderId: 'ord_1' } }],
    }),
  },
};

await anthropicProvider.probe?.(tool, { client });
```

No test in this repository makes a network request.
