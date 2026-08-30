# Prompt caching

Tool definitions sit at the very front of a Messages request and rarely change
between calls. That makes them the natural thing to cache: you pay to write the
prefix once, then read it back cheaply on every subsequent request that shares
it.

Caching is opt-in, per compile:

```ts
import { compileTool } from '@schemaport/provider-anthropic';

compileTool(tool, { cacheControl: true });
```

```json
{
  "name": "refund_order",
  "description": "Refunds all or part of an order",
  "input_schema": { "type": "object", "properties": { "orderId": { "type": "string" } } },
  "cache_control": { "type": "ephemeral" }
}
```

`true` is shorthand for `{ type: 'ephemeral' }`, which is the 5-minute cache.
For the extended lifetime, pass the object form:

```ts
compileTool(tool, { cacheControl: { type: 'ephemeral', ttl: '1h' } });
```

| Value | Emits |
|---|---|
| omitted, or `false` | no `cache_control` field at all |
| `true` | `{ "type": "ephemeral" }` |
| `{ type: 'ephemeral' }` | `{ "type": "ephemeral" }` |
| `{ type: 'ephemeral', ttl: '5m' }` | `{ "type": "ephemeral", "ttl": "5m" }` |
| `{ type: 'ephemeral', ttl: '1h' }` | `{ "type": "ephemeral", "ttl": "1h" }` |

`ttl` is omitted entirely rather than defaulted when you did not ask for one, so
a tool compiled with `cacheControl: true` is byte-identical every time.

## A breakpoint is not a per-tool switch

This is the part that is easy to get wrong, and the reason `compile()` always
says something when you use it.

`cache_control` marks a **breakpoint**, not a cached item. It caches everything
in the prompt *before and including* the block it sits on. In a `tools` array
that means the breakpoint belongs on the **last** stable tool, not on each one:

```ts
const tools = [
  compileTool(searchOrders),
  compileTool(refundOrder),
  compileTool(lookupCustomer, { cacheControl: true }),  // ← covers all three
];
```

Putting `cacheControl: true` on all three would spend three of your four
available breakpoints to achieve exactly what the one above achieves.

Two limits apply to the assembled request, and SchemaPort can check neither of
them — it compiles one tool at a time and never sees the request:

- **At most four breakpoints per request.** A fifth is an error from the API.
- **A minimum cacheable prefix length**, which varies by model. A prefix shorter
  than the model's minimum is silently not cached: no error, no saving. A single
  small tool definition will usually not reach it on its own.

So `compileTool` emits an `info` whenever you request a breakpoint:

```
ℹ A `cache_control` breakpoint caches every block before and including this
  tool, not this tool alone. Put it on the last stable tool in the `tools`
  array rather than on each one: a request may carry at most 4 breakpoints,
  and a prefix shorter than the model's minimum cacheable length is not
  cached at all. SchemaPort compiles one tool at a time and cannot verify
  either from here.
  Path: cacheControl
```

It is advisory. Nothing is wrong with the tool definition, and the compile
succeeds.

## Ordering the cached prefix

Caching only pays off if the cached prefix is *stable*. Two consequences worth
planning for:

- **Tool order must not change between requests.** The cache key covers the
  serialized prefix, so reordering the `tools` array invalidates it. SchemaPort
  compiles deterministically — the same canonical tool always produces the same
  bytes — so if you keep the array order fixed, the prefix stays stable.
- **Put volatile tools after the breakpoint.** A tool whose description is
  templated per user belongs *after* the breakpoint, otherwise every user gets a
  cache miss on the whole prefix.

## Diagnostics

| Code | Severity | When |
|---|---|---|
| `anthropic/cache-control-breakpoint-scope` | info | Any time a breakpoint is requested. Explains the scope and the two limits above. |
| `anthropic/cache-control-invalid-ttl` | warning | `ttl` is neither `5m` nor `1h`. |

An unrecognised `ttl` is **dropped**, and `cache_control` is still emitted
without it. Forwarding it would make the API reject the entire request, which
costs you the tool definition as well as the caching you asked for — a worse
outcome than falling back to the 5-minute default. TypeScript already rules this
out; the check exists for JavaScript callers and for values that arrive from
configuration.

## Interaction with `strict: true`

They are independent and compose. `cache_control` is emitted last, after
`strict`:

```ts
compileTool(tool, { strict: true, allowLossy: true, cacheControl: true });
```

```json
{
  "name": "refund_order",
  "input_schema": { "...": "..." },
  "strict": true,
  "cache_control": { "type": "ephemeral" }
}
```

## Not lossy

A breakpoint adds a field. It destroys no constraint and changes nothing about
the schema, so it is recorded as a non-lossy transformation
(`added-cache-control`) and compiles without `allowLossy`.

## Not covered here

SchemaPort emits the field; it does not manage your cache. It does not measure
prefix length, count breakpoints across a request, read `usage.cache_read_input_tokens`
off a response, or decide for you whether caching is worth it at your call
volume. Those all need the assembled request or the response, and this package
sees neither.

## Sources

- [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Messages API reference](https://platform.claude.com/docs/en/api/messages)
