import type { ProviderDocReference } from '@schemaport/core';

/**
 * Facts about Anthropic tool schemas, established from the official
 * documentation listed in {@link DOC_REFERENCES} on {@link RULES_REVIEWED_AT}.
 *
 * Everything in this file is evidence-backed. Where the documentation is silent
 * the constant name says so (`UNDOCUMENTED_*`) and the diagnostic wording says
 * "not documented as supported" rather than "rejected".
 */

export const PROVIDER_ID = 'anthropic';
export const DISPLAY_NAME = 'Anthropic';
export const RULES_REVIEWED_AT = '2026-08-20';

export const API_KEY_ENV_VAR = 'ANTHROPIC_API_KEY';
export const PROBE_MODEL_ENV_VAR = 'SCHEMAPORT_ANTHROPIC_MODEL';

/**
 * Cheapest currently available model that supports tool use.
 *
 * Models overview, "Latest models comparison": Claude Haiku 4.5 is
 * $1 / input MTok, $5 / output MTok — the lowest of any current model. The
 * alias `claude-haiku-4-5` resolves to `claude-haiku-4-5-20251001`.
 */
export const DEFAULT_PROBE_MODEL = 'claude-haiku-4-5';

/** `max_tokens` is required by the Messages API. Large enough that a forced tool call is not truncated. */
export const PROBE_MAX_TOKENS = 1024;

export const DOCS = {
  defineTools: 'https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools',
  strictToolUse: 'https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use',
  jsonSchemaLimitations:
    'https://platform.claude.com/docs/en/build-with-claude/structured-outputs#json-schema-limitations',
  toolReference: 'https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference',
  messagesApi: 'https://platform.claude.com/docs/en/api/messages',
  modelsOverview: 'https://platform.claude.com/docs/en/about-claude/models/overview',
} as const;

export const DOC_REFERENCES: readonly ProviderDocReference[] = Object.freeze([
  { title: 'Define tools', url: DOCS.defineTools },
  { title: 'Strict tool use', url: DOCS.strictToolUse },
  { title: 'Structured outputs — JSON Schema limitations', url: DOCS.jsonSchemaLimitations },
  { title: 'Tool reference — tool definition properties', url: DOCS.toolReference },
  { title: 'Messages API reference', url: DOCS.messagesApi },
  { title: 'Models overview', url: DOCS.modelsOverview },
]);

/**
 * Define tools: "`name` — The name of the tool. Must match the regex
 * `^[a-zA-Z0-9_-]{1,64}$`."
 */
export const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
export const TOOL_NAME_MAX_LENGTH = 64;

/**
 * Keywords the JSON Schema limitations page lists explicitly under
 * "Not supported". They are accepted in the default (non-strict) request
 * because `input_schema` is passed through to the prompt verbatim, but
 * Anthropic never enforces them: not in default tool use, and enabling
 * `strict: true` returns a 400 rather than enforcing them.
 */
export const NEVER_ENFORCED_KEYWORDS = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'maxItems',
  'uniqueItems',
] as const;

/**
 * Keywords absent from both the "Supported features" and "Not supported"
 * lists. Absence is not a documented rejection, so diagnostics for these say
 * "not documented as supported".
 *
 * `pattern` is a special case: it appears in neither list, but the strict tool
 * use data-retention note ("Do not include PHI in `input_schema` property
 * names, `enum` values, `const` values, or `pattern` regular expressions")
 * implies it is compiled into the grammar. Its status is genuinely uncertain,
 * so it is reported as a warning rather than assumed to work.
 */
export const UNDOCUMENTED_KEYWORDS = [
  'maxProperties',
  'minProperties',
  'not',
  'oneOf',
  'pattern',
  'prefixItems',
] as const;

/**
 * JSON Schema limitations, "Supported features":
 * "String formats: `date-time`, `time`, `date`, `duration`, `email`,
 * `hostname`, `uri`, `ipv4`, `ipv6`, `uuid`".
 */
export const DOCUMENTED_STRING_FORMATS: ReadonlySet<string> = new Set([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'uri',
  'ipv4',
  'ipv6',
  'uuid',
]);

/**
 * JSON Schema limitations, "Supported features": "Array `minItems` (only
 * values 0 and 1 supported)".
 */
export const SUPPORTED_MIN_ITEMS: ReadonlySet<number> = new Set([0, 1]);

/** Diagnostic codes, exported so callers can match on them without string literals. */
export const CODES = {
  invalidToolName: 'anthropic/invalid-tool-name',
  inputSchemaNotObject: 'anthropic/input-schema-not-object',
  missingInputSchemaType: 'anthropic/missing-input-schema-type',
  schemaNotEnforced: 'anthropic/schema-not-enforced',
  constraintNotEnforced: 'anthropic/constraint-not-enforced',
  keywordNotDocumented: 'anthropic/keyword-not-documented',
  undocumentedStringFormat: 'anthropic/undocumented-string-format',
  enumNonPrimitiveValue: 'anthropic/enum-non-primitive-value',
  externalRef: 'anthropic/external-ref',
  missingToolDescription: 'anthropic/missing-tool-description',
} as const;

/** Transformation codes emitted by `compile()`. */
export const TRANSFORMATIONS = {
  renamedInputSchemaField: 'renamed-input-schema-field',
  addedInputSchemaType: 'added-input-schema-type',
} as const;
