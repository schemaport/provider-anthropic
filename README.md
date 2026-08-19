# @schemaport/provider-anthropic

Anthropic target for [SchemaPort](https://github.com/schemaport). Checks a
canonical tool schema against the Anthropic Messages API's tool-use rules,
compiles it to a ready-to-send tool definition, and can probe the live API to
confirm the definition is accepted.

- **Provider id:** `anthropic`
- **API surface:** Messages API (`POST /v1/messages`), the `tools` array
- **`rulesReviewedAt`:** `2026-08-20`
- **SDK used for probing:** `@anthropic-ai/sdk` 0.119.0
- **API key environment variable:** `ANTHROPIC_API_KEY`

## Install

```bash
npm install @schemaport/provider-anthropic
```

## Usage

```ts
import { anthropicProvider } from '@schemaport/provider-anthropic';

const tool = {
  name: 'refund_order',
  description: 'Refunds all or part of an order',
  inputSchema: {
    type: 'object',
    properties: {
      orderId: { type: 'string', description: 'The order to refund' },
      amount: { type: 'number', minimum: 0 },
    },
    required: ['orderId'],
  },
};

anthropicProvider.check(tool);        // Diagnostic[]
anthropicProvider.compile(tool);      // CompileResult, `output` goes straight into `tools`
await anthropicProvider.probe(tool);  // ProbeResult (needs ANTHROPIC_API_KEY)
```

`compile().output` is the Anthropic tool object:

```json
{
  "name": "refund_order",
  "description": "Refunds all or part of an order",
  "input_schema": {
    "type": "object",
    "properties": {
      "orderId": { "type": "string", "description": "The order to refund" },
      "amount": { "type": "number", "minimum": 0 }
    },
    "required": ["orderId"]
  }
}
```

## The one thing to know about this target

Anthropic is the most permissive target SchemaPort supports. Nothing in a
canonical schema has to be dropped: `input_schema` is an open JSON Schema
object (the SDK types it as `{ type: 'object'; [k: string]: unknown }`) and the
Messages API renders it into the tool-use system prompt verbatim. **No
transformation this package emits is lossy.**

That permissiveness is exactly the trap. *Accepted* is not *enforced*. By
default the Messages API does not validate tool inputs at all — Anthropic's own
documentation says that without strict mode "Claude might return incompatible
types (`"2"` instead of `2`) or omit required fields". Input validation only
happens when a tool sets `strict: true`, and the strict subset **rejects**
`minimum`, `maximum`, `multipleOf`, `minLength`, `maxLength` and most array
constraints with a 400.

So this package:

- compiles to the default, non-strict form, preserving every keyword;
- emits `anthropic/schema-not-enforced` (warning) on any tool that actually
  constrains something, because that is the honest report;
- emits `anthropic/constraint-not-enforced` (warning) per keyword that Anthropic
  can never enforce, in either mode.

A tool with constraints will therefore compile successfully **and** report
warnings. That is by design, not noise: "compiles cleanly with zero warnings"
would be a false statement about this provider. A tool that constrains nothing
(`{ "type": "object", "properties": {} }`) reports clean.

SchemaPort does not emit `strict: true`. See
[docs/limitations.md](docs/limitations.md) for why.

## Documentation

| Document | Contents |
|---|---|
| [docs/compatibility-rules.md](docs/compatibility-rules.md) | Every rule, its code, severity and compile behaviour |
| [docs/transformations.md](docs/transformations.md) | Every transformation and its lossy classification |
| [docs/limitations.md](docs/limitations.md) | Accepted-but-not-enforced keywords, and what this package does not do |
| [docs/probing.md](docs/probing.md) | Probe setup, model selection, exact commands |
| [docs/examples.md](docs/examples.md) | Worked examples against the shared fixtures |
| [docs/sources.md](docs/sources.md) | Every official documentation URL the rules came from |

## Diagnostic codes

| Code | Severity |
|---|---|
| `anthropic/invalid-tool-name` | error |
| `anthropic/input-schema-not-object` | error |
| `anthropic/missing-input-schema-type` | error (compile fixes it) |
| `anthropic/schema-not-enforced` | warning |
| `anthropic/constraint-not-enforced` | warning |
| `anthropic/keyword-not-documented` | warning |
| `anthropic/undocumented-string-format` | warning |
| `anthropic/enum-non-primitive-value` | warning |
| `anthropic/external-ref` | warning |
| `anthropic/missing-tool-description` | info |

## Development

```bash
npm run build
npm test
npm run lint
```

Tests never make network requests; `probe()` takes an `options.client` seam.

## License

MIT
