# Changelog

All notable changes to `@schemaport/provider-anthropic` are documented in this
file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
