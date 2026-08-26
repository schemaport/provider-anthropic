# Changelog

All notable changes to `@schemaport/provider-anthropic` are documented in this
file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Opt-in `strict: true` compilation.** `compile(tool, { strict: true })` emits
  the enforced form of an Anthropic tool definition: `strict: true` on the tool,
  `additionalProperties: false` on every object, and every declared property
  listed in `required`. Anthropic validates tool inputs only in this mode.
  - New option type `AnthropicCompileOptions extends CompileOptions`, plus
    `AnthropicProbeOptions extends ProbeOptions` and `AnthropicCheckOptions`.
    Every added field is optional, so `anthropicProvider` — now typed
    `AnthropicProvider` — remains assignable to `SchemaPortProvider` and
    `@schemaport/core` is unchanged.
  - `AnthropicToolDefinition` gained an optional `strict?: true` field.
- **Strict compilation drops what the strict subset rejects, and refuses to do
  it silently.** Numerical constraints (`minimum`, `maximum`,
  `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`), string constraints
  (`minLength`, `maxLength`), array constraints beyond `minItems` of 0 or 1
  (`maxItems`, `uniqueItems`, other `minItems` values) and a typed
  `additionalProperties` schema are dropped, each as its own **lossy**
  transformation. `finalizeCompile` therefore refuses a strict compile of any
  schema carrying one unless the caller also passes `allowLossy`. The PRD's own
  `refund_order` example is refused, because `amount.minimum: 0` cannot survive.
- New transformations: `enabled-strict-mode`, `dropped-numeric-constraint`,
  `dropped-string-constraint`, `dropped-array-constraint`,
  `dropped-additional-properties-schema`, `closed-open-object`,
  `added-additional-properties-false`, `required-every-property`. Only the four
  `dropped-*` codes are lossy.
- Eight strict-only diagnostics, none of them emitted when strict is off:
  `anthropic/strict-drops-numeric-constraint`,
  `anthropic/strict-drops-string-constraint`,
  `anthropic/strict-drops-array-constraint`,
  `anthropic/strict-drops-additional-properties`,
  `anthropic/strict-always-present-property`,
  `anthropic/strict-closed-open-object`,
  `anthropic/strict-keyword-undocumented`, `anthropic/strict-local-ref`.
- `probe(tool, { strict: true })` sends the strict definition. Every existing
  probe guarantee is unchanged, including compiling first: a strict schema whose
  losses the caller has not accepted is never sent, and comes back as
  `errorKind: 'compile-refused'`.
- `check(tool, { strict: true })` returns the strict rule set. `check(tool)` is
  unchanged.

### Known gap

- Strict compilation lists every declared property in `required`. That is the
  one strict rule this package cannot cite a documented line for: the reviewed
  pages give `additionalProperties: false` as the strict subset's object
  requirement and say nothing about optional properties. The behaviour is
  applied, labelled as SchemaPort's own choice in
  `anthropic/strict-always-present-property`, and recorded as a gap in
  `docs/sources.md` rather than dressed up with a citation.
- Exports: `STRICT_ONLY_CODES`, `STRICT_DROPPED_KEYWORDS`,
  `STRICT_REJECTED_KEYWORDS`.

### Changed

- `anthropic/schema-not-enforced` now says SchemaPort **can** emit `strict: true`
  on request, because that is newly true. Its severity, path and trigger are
  unchanged. This is the only change to the default-mode diagnostics.
- Documentation rewritten where strict mode falsified it: the
  "SchemaPort does not emit `strict: true`" section of `docs/limitations.md` is
  now a description of the capability and its cost, and
  `docs/compatibility-rules.md`, `docs/transformations.md`, `docs/probing.md`,
  `docs/examples.md` and `README.md` all document both modes.

### Unchanged

- **The default path.** `compile(tool)` with no options emits exactly what it
  emitted before, byte for byte. `test/baseline-main.ts` pins the previous
  output for all six shared `@schemaport/core` fixtures and the suite asserts
  byte-identical output, identical transformations and an identical set of
  rules, paths and severities.
- No keyword is dropped, and no lossy transformation is emitted, unless
  `strict: true` is asked for.
- `rulesReviewedAt` stays `2026-08-20`: strict mode is implemented from the
  research already recorded in `docs/`, not from a new documentation review.

## [0.1.0] - 2026-08-20

### Added

- `anthropicProvider`, implementing the `SchemaPortProvider` contract for the
  Anthropic Messages API (`POST /v1/messages`, `tools` array). Also available as
  the default export.
- `check()` with ten compatibility rules, reviewed against official Anthropic
  documentation on 2026-08-20:
  - `anthropic/invalid-tool-name` (error) — name outside `^[a-zA-Z0-9_-]{1,64}$`.
  - `anthropic/input-schema-not-object` (error) — root schema is not an object.
  - `anthropic/missing-input-schema-type` (error) — root schema has no `type`;
    compile adds `"type": "object"`.
  - `anthropic/schema-not-enforced` (warning) — default tool use does not
    validate tool inputs against the schema.
  - `anthropic/constraint-not-enforced` (warning) — keywords Anthropic
    documents as unsupported, which are never enforced in either mode.
  - `anthropic/keyword-not-documented` (warning) — `oneOf`, `not`,
    `prefixItems`, `minProperties`, `maxProperties`, `pattern`.
  - `anthropic/undocumented-string-format` (warning) — `format` outside the
    documented set.
  - `anthropic/enum-non-primitive-value` (warning) — complex types in `enum`.
  - `anthropic/external-ref` (warning) — `$ref` outside the document.
  - `anthropic/missing-tool-description` (info).
- `compile()` producing a ready-to-send Anthropic tool definition
  (`name`, `description?`, `input_schema`) via `finalizeCompile`, with two
  transformations, both non-lossy: `renamed-input-schema-field` and
  `added-input-schema-type`. No keyword is ever dropped.
- `probe()` using `@anthropic-ai/sdk` 0.119.0, defaulting to model
  `claude-haiku-4-5`, overridable with `options.model` and
  `SCHEMAPORT_ANTHROPIC_MODEL`. Supports `options.client` as a test seam,
  classifies failures with `classifyProviderError`, and never inspects tool
  arguments from a response truncated at `max_tokens`.
- Vitest suite covering every rule, deterministic compilation, the compile
  refusal paths, and mocked probe outcomes (accepted, rejected, missing
  credentials, 404 model-not-found, authentication, network, compile-refused).
  No test makes a network request.
- Documentation: `README.md` plus `docs/compatibility-rules.md`,
  `docs/transformations.md`, `docs/limitations.md`, `docs/probing.md`,
  `docs/examples.md` and `docs/sources.md`.

[0.1.0]: https://github.com/schemaport/provider-anthropic/releases/tag/v0.1.0
