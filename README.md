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

anthropicProvider.check(tool);          // Diagnostic[]
anthropicProvider.compile(tool);        // CompileResult, `output` goes straight into `tools`
await anthropicProvider.probe?.(tool);  // ProbeResult (needs ANTHROPIC_API_KEY)

// Opt in to the enforced form. See "strict mode", below.
anthropicProvider.compile(tool, { strict: true, allowLossy: true });
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

Anthropic's default tool-use path is the most permissive target SchemaPort
supports. Nothing in a canonical schema has to be dropped: `input_schema` is an
open JSON Schema object (the SDK types it as
`{ type: 'object'; [k: string]: unknown }`) and the Messages API renders it into
the tool-use system prompt verbatim. **`compile(tool)` emits no lossy
transformation at all.**

That permissiveness is exactly the trap. *Accepted* is not *enforced*. By
default the Messages API does not validate tool inputs at all — Anthropic's own
documentation says that without strict mode "Claude might return incompatible
types (`"2"` instead of `2`) or omit required fields". Input validation only
happens when a tool sets `strict: true`, and the strict subset **rejects**
`minimum`, `maximum`, `multipleOf`, `minLength`, `maxLength` and most array
constraints with a 400.

So by default this package:

- compiles to the default, non-strict form, preserving every keyword;
- emits `anthropic/schema-not-enforced` (warning) on any tool that actually
  constrains something, because that is the honest report;
- emits `anthropic/constraint-not-enforced` (warning) per keyword that Anthropic
  can never enforce.

A tool with constraints will therefore compile successfully **and** report
warnings. That is by design, not noise: "compiles cleanly with zero warnings"
would be a false statement about this provider. A tool that constrains nothing
(`{ "type": "object", "properties": {} }`) reports clean.

## Strict mode

```ts
anthropicProvider.compile(tool, { strict: true });
```

emits the enforced form: `strict: true` on the tool definition, every object
closed with `additionalProperties: false`, and every declared property listed in
`required`. (The closed-object requirement is documented; listing every property
in `required` is SchemaPort's own choice, because the strict subset has no
documented way to express an optional property. The
`anthropic/strict-always-present-property` warning says so.)

It costs constraints. The strict subset rejects a documented set of keywords
with a 400, so strict compilation **drops** them:

| Dropped under `strict: true` | Documented as |
|---|---|
| `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf` | "Numerical constraints (such as `minimum`, `maximum`, `multipleOf`)" |
| `minLength`, `maxLength` | "String constraints (`minLength`, `maxLength`)" |
| `maxItems`, `uniqueItems`, `minItems` other than `0` or `1` | "Array constraints beyond `minItems` of 0 or 1" |
| a typed `additionalProperties` schema | "`additionalProperties` set to anything other than `false`" |

Dropping a constraint is lossy, so a strict compile of a schema carrying any of
them is **refused** unless you also pass `allowLossy` — the same gate every
other SchemaPort target uses:

```ts
anthropicProvider.compile(refundOrderTool, { strict: true });
// ok: false — core/lossy-transformation-refused
//   dropped-numeric-constraint at inputSchema.properties.amount.minimum

anthropicProvider.compile(refundOrderTool, { strict: true, allowLossy: true });
// ok: true — `minimum: 0` is gone, `amount` is now required, the object is closed
```

Strict mode buys enforcement and pays for it with constraints. Which you want
depends on where your schema's meaning lives:

| | Default | `strict: true` |
|---|---|---|
| Anthropic validates tool inputs | no | yes |
| `minimum` / `maxLength` / `maxItems` … | sent, never enforced | **dropped** |
| Optional properties | stay optional | become required |
| Open objects and typed maps | preserved | closed |
| Needs `allowLossy` | never | whenever a rejected keyword is present |

Keywords the documentation classifies neither way — `pattern`, `oneOf`, `not`,
`prefixItems`, `minProperties`, `maxProperties` — are **kept** under strict
mode, with a warning saying SchemaPort cannot tell you whether Anthropic accepts
them. Dropping a keyword the documentation does not reject would destroy a
constraint for a reason this package cannot cite.

Strict mode is a **library-level option**. The `schemaport` CLI has no
`--strict` flag: its `compile` command calls `compile(tool, { allowLossy })` and
nothing else, so `schemaport compile --targets anthropic` still emits the
default form. Exposing the option on the command line is a change to the CLI
package, not this one.

Everything above is documented in detail, with sources, in
[docs/limitations.md](docs/limitations.md).

## Prompt caching

Tool definitions sit at the front of the prompt and rarely change, which makes
them worth caching. `cacheControl` emits the `cache_control` field that turns
caching on:

```ts
anthropicProvider.compile(tool, { cacheControl: true });
// { name, description, input_schema, cache_control: { type: 'ephemeral' } }

compileTool(tool, { cacheControl: { type: 'ephemeral', ttl: '1h' } });
```

`cache_control` marks a **breakpoint**, which caches everything before and
including the tool it sits on — so it belongs on the last stable tool in the
`tools` array, not on each one. A request may carry at most four breakpoints,
and a prefix below the model's minimum length is not cached at all. SchemaPort
compiles one tool at a time and cannot check either, so it emits an `info`
saying so whenever you ask for a breakpoint.

Adding a breakpoint destroys no constraint, so it is not lossy and needs no
`allowLossy`. Full details in
[docs/prompt-caching.md](docs/prompt-caching.md).

## Documentation

| Document | Contents |
|---|---|
| [docs/compatibility-rules.md](docs/compatibility-rules.md) | Every rule, its code, severity and compile behaviour |
| [docs/transformations.md](docs/transformations.md) | Every transformation and its lossy classification |
| [docs/limitations.md](docs/limitations.md) | Accepted-but-not-enforced keywords, the strict-mode trade-off, and what this package does not do |
| [docs/prompt-caching.md](docs/prompt-caching.md) | `cacheControl`, breakpoint scope, the four-breakpoint and prefix-length limits |
| [docs/probing.md](docs/probing.md) | Probe setup, model selection, exact commands, strict probes |
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

Strict-mode only — emitted by `check(tool, { strict: true })` and
`compile(tool, { strict: true })`, never otherwise:

| Code | Severity |
|---|---|
| `anthropic/strict-drops-numeric-constraint` | error (compile fix is lossy) |
| `anthropic/strict-drops-string-constraint` | error (compile fix is lossy) |
| `anthropic/strict-drops-array-constraint` | error (compile fix is lossy) |
| `anthropic/strict-drops-additional-properties` | error (lossy for a typed map) |
| `anthropic/strict-always-present-property` | warning |
| `anthropic/strict-closed-open-object` | warning |
| `anthropic/strict-keyword-undocumented` | warning |
| `anthropic/strict-local-ref` | warning |
| `anthropic/cache-control-breakpoint-scope` | info |
| `anthropic/cache-control-invalid-ttl` | warning |

## Development

```bash
npm run build
npm test
npm run lint
```

Tests never make network requests; `probe()` takes an `options.client` seam.

## License

MIT
