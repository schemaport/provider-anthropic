# Known limitations

Reviewed **2026-08-20** against the sources in [sources.md](sources.md).

## Accepted is not enforced (in the default form)

This is the single most important thing to understand about the Anthropic
target, and the reason a compatible tool still reports warnings. It describes
the **default** compilation; `strict: true`, below, is the way out of it — and
has its own price.

The Messages API accepts arbitrary JSON Schema in `input_schema` and renders it
into the tool-use system prompt. It performs no validation of the model's tool
inputs in the default configuration. Anthropic states this directly on the
Strict tool use page:

> Without strict mode, Claude might return incompatible types (`"2"` instead of
> `2`) or omit required fields, breaking your functions and causing runtime
> errors.

So for a tool compiled by this package without `strict: true`:

| | Sent to Anthropic | Enforced by Anthropic |
|---|---|---|
| `type` | yes | no |
| `required` | yes | no |
| `enum`, `const` | yes | no |
| `minimum`, `maximum`, `maxLength`, `minLength`, … | yes | no |
| `pattern` | yes | unknown — see below |

`check()` reports this as `anthropic/schema-not-enforced` on every tool whose
root schema declares at least one property or required property. It is a
warning, not a clean pass. `check(tool, { strict: true })` does not emit it,
because under strict mode the statement is false.

## `strict: true` is available, and it costs constraints

Setting `strict: true` on a tool definition is the only way Anthropic enforces
the schema — it constrains sampling to schema-valid output. **This package can
emit it, as an opt-in.** It is off by default, and it is off by default for a
reason worth understanding before you turn it on.

```ts
anthropicProvider.compile(tool);                                    // default: permissive, unenforced
anthropicProvider.compile(tool, { strict: true });                  // enforced — refuses if that costs a constraint
anthropicProvider.compile(tool, { strict: true, allowLossy: true }); // enforced, losses accepted and recorded
```

### What strict mode drops

The strict subset **rejects with a 400** every keyword in the
`anthropic/constraint-not-enforced` table, so strict compilation removes them:

| Dropped | Documented as | Transformation |
|---|---|---|
| `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf` | "Numerical constraints (such as `minimum`, `maximum`, `multipleOf`)" | `dropped-numeric-constraint` |
| `minLength`, `maxLength` | "String constraints (`minLength`, `maxLength`)" | `dropped-string-constraint` |
| `maxItems`, `uniqueItems`, and `minItems` with a value other than `0` or `1` | "Array constraints beyond `minItems` of 0 or 1" | `dropped-array-constraint` |
| a typed `additionalProperties` schema | "`additionalProperties` set to anything other than `false`" | `dropped-additional-properties-schema` |

Every one of those is a **lossy** transformation: the compiled schema accepts
inputs the canonical schema rejects. So `compile(tool, { strict: true })` is
*refused* for any tool carrying one of them, exactly like every other lossy
compile in SchemaPort. The refusal comes from `finalizeCompile` in
`@schemaport/core`, not from this package.

That includes the PRD's own example. `refund_order` has `amount.minimum: 0`:

```
$ compile(refundOrderTool, { strict: true })
ok: false
error core/lossy-transformation-refused  inputSchema
  Compiling for anthropic would weaken this schema:
  dropped-numeric-constraint at inputSchema.properties.amount.minimum.
  Re-run with --allow-lossy to accept the weaker output.
```

Adding `allowLossy` compiles it and records what was given up. See
[examples.md](examples.md) for the full output.

### What strict mode adds

Strict compilation also closes every object with `additionalProperties: false`,
which the subset documents, and lists every declared property in `required`.
Neither is lossy — no canonical constraint stops being enforced — but both
change what the model emits at runtime, so both are warned about:

- `anthropic/strict-always-present-property` — an optional property is now
  required, so the model will always send it. **This is the change most likely
  to surprise you**, and it is not gated by `allowLossy`, because SchemaPort's
  lossy gate is about the schema getting *weaker*, not stricter.
- `anthropic/strict-closed-open-object` — an object that declared
  `additionalProperties: true` no longer accepts undeclared keys.

One honest caveat about the first of those. Every other strict rule in this
package quotes a documented "Not supported" entry. This one does not: the
reviewed pages give `additionalProperties: false` as the strict subset's object
requirement and say **nothing** about optional properties. SchemaPort lists
every property in `required` because the subset has no documented way to express
optionality — but it does not claim Anthropic would reject the schema otherwise,
and the warning text says as much. If you need optional properties preserved,
the default form is the one that keeps them.

### Which one do you want?

| | Default | `strict: true` |
|---|---|---|
| Anthropic validates tool inputs | no | yes |
| `minimum` / `maxLength` / `maxItems` … | sent, never enforced | **dropped** |
| `pattern`, `oneOf`, `prefixItems`, `minProperties` | sent, enforcement unknown | sent, acceptance unknown |
| Optional properties | stay optional | become required |
| Open objects and typed maps | preserved | closed |
| Needs `--allow-lossy` | never | whenever a rejected keyword is present |

The short version: **strict mode buys enforcement of the keywords that survive,
and pays for it with the keywords that do not.** If your constraints live in
`minimum`/`maxLength`/`maxItems`, strict mode enforces the types and drops the
constraints, and you should keep validating server-side either way. If your
schema is mostly types, enums, required properties and closed objects, strict
mode is close to free.

### Strict mode is not on the command line

`strict` is an option on this package's `compile()` and `probe()`. The
`schemaport` CLI does not have a `--strict` flag: it calls
`provider.compile(tool, { allowLossy })`, so every CLI compile emits the default
form. Reaching strict mode means calling the provider from code. Adding the flag
is a change to the CLI package, which this one does not control.

### What SchemaPort will not do for you

Strict compilation drops **only** the keywords the documentation lists as
unsupported. It does not drop keywords the documentation is silent about
(`pattern`, `oneOf`, `not`, `prefixItems`, `minProperties`, `maxProperties`), an
`enum` with a non-primitive member, an undocumented `format`, or an external
`$ref`. Absence from a support list is not a documented rejection, and dropping
a keyword on that basis would destroy a constraint for a reason this package
cannot cite. Those are reported as uncertain — the request may still come back
as a 400 — and left in the schema. Probe the tool if you need to know.

## `pattern` support is genuinely unclear

`pattern` appears in neither the supported nor the unsupported list of the JSON
Schema limitations page. The Strict tool use data-retention note warns against
putting PHI in "`pattern` regular expressions", which implies it is compiled
into the grammar under strict mode — but that is an inference, not a support
statement. Reported as `anthropic/keyword-not-documented` in the default mode
and `anthropic/strict-keyword-undocumented` under `strict: true`, rather than
assumed to work in either direction.

Strict compilation therefore **keeps** `pattern`. If the inference is right, you
get regex enforcement for free. If it is wrong, Anthropic returns a 400 and you
have learned something the documentation would not tell you. Dropping it
pre-emptively would have destroyed a real constraint to avoid a hypothetical
error.

## Rules derived from absence

`oneOf`, `not`, `prefixItems`, `minProperties` and `maxProperties` are also
absent from both lists. The page says "If you use an unsupported feature, you'll
receive a 400 error with details", but joining that to "absent from the
supported list" is a two-step inference. These are reported as "not documented
as supported", not as rejections — and they are **kept** by strict compilation
for the same reason `pattern` is. Under `strict: true` the warning says the
request may be rejected; it does not promise either outcome.

**Union `type` arrays** (`"type": ["string", "null"]`) are also absent from both
lists. They are passed through untouched and are *not* flagged. Anthropic's
`enum` support explicitly includes nulls and `anyOf` is documented as supported,
so a type array is not obviously outside the subset — but neither is it
documented as inside it. No rule is emitted rather than guessing; the
tool-level `anthropic/schema-not-enforced` warning still applies in the default
mode. Strict compilation passes them through untouched, which means a strict
tool using a union type may be rejected. SchemaPort will not rewrite the union,
because every rewrite it could pick (dropping a member, wrapping in `anyOf`)
would be a guess about a subset the documentation does not describe.

## Not implemented

Behaviour this package deliberately does not model, because the documentation
does not support a rule:

- **Recursive schema detection.** Recursive schemas are documented as
  unsupported under `strict: true`, which this package now emits — but only on
  request. SchemaPort does not resolve `$ref`, so it cannot decide whether a
  schema is recursive. Rather than guess, strict compilation emits
  `anthropic/strict-local-ref` on *every* local `$ref`, saying plainly that it
  cannot confirm the schema is non-recursive and that a recursive one will be
  rejected with a 400. That is a warning about uncertainty, not a detection.
- **Description or schema size limits.** Neither the Messages API reference nor
  the Tool reference documents a maximum description length, a maximum
  `input_schema` size, or a maximum number of tools. No rule.
- **Per-model differences.** The default tool-use path is available across
  current models, so no model-specific rule is applied to it. The Strict tool
  use page lists the models that support `strict: true`, and SchemaPort does
  **not** check the probe model against that list: `compile(tool, { strict: true })`
  does not know which model you will send the tool to, and `probe()` would have
  to keep a model list current to check. A strict probe against a model without
  strict support will come back as a `rejected` schema; cross-check
  `providerError.message` before believing it.
- **`$defs` inlining.** Local `$ref`/`$defs` are documented as supported and are
  passed through untouched in both modes. Strict compilation descends into
  `$defs` to apply the subset's rules, but never inlines or resolves a
  reference.
- **`input_examples`, `cache_control`, `defer_loading`, `allowed_callers`.**
  These optional tool-definition properties are outside SchemaPort's canonical
  format and are never emitted.

## Probe limitations

- The probe answers "was this tool definition accepted?", not "does the model
  respect the schema?" — one sampled call is not evidence about enforcement,
  in either mode. A single strict call coming back valid does not prove strict
  mode is working; a single default call coming back valid proves even less.
- A response truncated at `max_tokens` carries a partially written tool input.
  Those arguments are **not** inspected, because reporting them would be
  indistinguishable from a real schema violation. The result is `accepted` with
  a note.
- Argument validation uses `@schemaport/core`'s `validateValue`, which does not
  resolve `$ref` and does not check `format`.
- A strict probe validates the returned arguments against the **canonical**
  schema, not the reduced strict one. That is deliberate: it is how a constraint
  strict mode forced SchemaPort to drop shows up as `argumentsValid: false`
  while the schema itself was accepted.
- The probe sends `tool_choice: { type: 'tool', name: … }` so that a call is
  always produced. Core's `classifyProviderError` maps any 400/422 that does not
  mention a missing model to `rejected`, so a 400 caused by the *forced tool
  choice* rather than the schema — for example a model that does not support
  forced tool use — would be reported as a schema rejection. Cross-check a
  `rejected` verdict's `providerError.message` before acting on it.
