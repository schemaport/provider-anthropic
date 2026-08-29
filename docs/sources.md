# Sources

`rulesReviewedAt`: **2026-08-20**

Every rule in this package is derived from the official Anthropic documentation
below, or from the installed SDK. No rule is based on blog posts, community
reports, or recollection. Where the documentation is silent, the diagnostic says
so rather than asserting behaviour.

## Official documentation

| Source | Used for |
|---|---|
| [Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools) | Tool definition shape (`name`, `description`, `input_schema`, `input_examples`); the `^[a-zA-Z0-9_-]{1,64}$` name regex; the constructed tool-use system prompt showing the schema rendered verbatim; description best practices |
| [Strict tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use) | What `strict: true` guarantees (grammar-constrained sampling); the statement that without strict mode Claude may return incompatible types or omit required fields; the `pattern`-compiled-into-grammar implication in the data-retention note |
| [Structured outputs — JSON Schema limitations](https://platform.claude.com/docs/en/build-with-claude/structured-outputs#json-schema-limitations) | The supported/unsupported keyword lists; the documented string-format set; the `minItems` 0-or-1 rule; the `additionalProperties: false` requirement; "If you use an unsupported feature, you'll receive a 400 error with details" |
| [Tool reference](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference) | The optional tool-definition properties (`strict`, `cache_control`, `defer_loading`, `allowed_callers`, `input_examples`, `eager_input_streaming`) and the absence of documented size limits |
| [Messages API reference](https://platform.claude.com/docs/en/api/messages) | `tools` parameter shape; `input_schema.type` fixed to `"object"`; `max_tokens` required; no documented description length limit or tool count limit |
| [Models overview](https://platform.claude.com/docs/en/about-claude/models/overview) | The default probe model: Claude Haiku 4.5 (`claude-haiku-4-5`, alias of `claude-haiku-4-5-20251001`) is the cheapest current model at $1 / $5 per MTok |

## Installed SDK

`@anthropic-ai/sdk` **0.119.0**, at
`node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts`:

```ts
export interface Tool {
  input_schema: Tool.InputSchema;
  name: string;
  description?: string;
  strict?: boolean;   // "When true, guarantees schema validation on tool names and inputs"
  // ...cache_control, defer_loading, allowed_callers, input_examples, eager_input_streaming
}

export declare namespace Tool {
  interface InputSchema {
    type: 'object';
    properties?: unknown | null;
    required?: Array<string> | null;
    [k: string]: unknown;      // <- why nothing has to be dropped
  }
}
```

Used to confirm the exact field name `input_schema`, that `type` is the literal
`'object'`, that the schema object is open to arbitrary keywords, and the exact
name and meaning of the optional `strict` field that
`compile(tool, { strict: true })` emits.

## What was checked but produced no rule

- **Description / schema size limits.** Not documented on the Messages API
  reference or the Tool reference. No rule invented.
- **Maximum number of tools.** Not documented. No rule.
- **Recursive schemas.** Documented as unsupported under `strict: true`, which
  this package emits on request. Detecting recursion would mean resolving
  `$ref`, which SchemaPort does not do, so there is no detection rule — only
  `anthropic/strict-local-ref`, which states the uncertainty.
- **"Every property must be listed in `required`" under `strict: true`.** Not
  recorded here. The reviewed pages give one object requirement for the strict
  subset — `additionalProperties: false` — and say nothing about optional
  properties. Strict compilation nevertheless lists every declared property in
  `required`, because the subset has no documented way to express optionality.
  That is a **choice this package makes, not a documented API rule**, and
  `anthropic/strict-always-present-property` says so in the diagnostic itself
  rather than citing a page for it.
- **Which models support `strict: true`.** The Strict tool use page lists them.
  SchemaPort does not embed that list: it would go stale between reviews, and
  `compile()` does not know which model the tool will be sent to. No rule.
