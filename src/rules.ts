import type { JsonSchema, ProviderDocReference } from '@schemaport/core';
import { isPlainObject, isType } from '@schemaport/core';

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
 * The same "Not supported" keywords, grouped the way the JSON Schema
 * limitations page groups them.
 *
 * `strict: true` does not merely ignore these — the page states "If you use an
 * unsupported feature, you'll receive a 400 error with details". Strict
 * compilation therefore has to *drop* them, which is why every drop is recorded
 * as a lossy transformation.
 *
 * The two constraints that are value-dependent rather than keyword-dependent —
 * `minItems` outside {0, 1} and `additionalProperties` other than `false` — are
 * handled separately, against {@link SUPPORTED_MIN_ITEMS} and the object rules.
 */
export const STRICT_REJECTED_KEYWORDS = {
  /** "Numerical constraints (such as `minimum`, `maximum`, `multipleOf`)". */
  numeric: ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'],
  /** "String constraints (`minLength`, `maxLength`)". */
  string: ['minLength', 'maxLength'],
  /** "Array constraints beyond `minItems` of 0 or 1". */
  array: ['maxItems', 'uniqueItems'],
} as const satisfies Record<string, readonly string[]>;

/** Every keyword strict compilation drops outright, flattened. */
export const STRICT_DROPPED_KEYWORDS: readonly string[] = Object.freeze([
  ...STRICT_REJECTED_KEYWORDS.numeric,
  ...STRICT_REJECTED_KEYWORDS.string,
  ...STRICT_REJECTED_KEYWORDS.array,
]);

/** Which rejected class a keyword belongs to, or `undefined` if strict keeps it. */
export function strictRejectedClass(keyword: string): 'numeric' | 'string' | 'array' | undefined {
  for (const [name, keywords] of Object.entries(STRICT_REJECTED_KEYWORDS)) {
    if ((keywords as readonly string[]).includes(keyword)) {
      return name as 'numeric' | 'string' | 'array';
    }
  }
  return undefined;
}

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

  // Strict-mode rules. These fire only when the caller asked for
  // `strict: true`; nothing below is ever emitted for a default compile.
  strictDropsNumericConstraint: 'anthropic/strict-drops-numeric-constraint',
  strictDropsStringConstraint: 'anthropic/strict-drops-string-constraint',
  strictDropsArrayConstraint: 'anthropic/strict-drops-array-constraint',
  strictDropsAdditionalProperties: 'anthropic/strict-drops-additional-properties',
  strictAlwaysPresentProperty: 'anthropic/strict-always-present-property',
  strictClosedOpenObject: 'anthropic/strict-closed-open-object',
  strictKeywordUndocumented: 'anthropic/strict-keyword-undocumented',
  strictLocalRef: 'anthropic/strict-local-ref',
} as const;

/** Diagnostic codes that are only ever emitted under `strict: true`. */
export const STRICT_ONLY_CODES: readonly string[] = Object.freeze([
  CODES.strictDropsNumericConstraint,
  CODES.strictDropsStringConstraint,
  CODES.strictDropsArrayConstraint,
  CODES.strictDropsAdditionalProperties,
  CODES.strictAlwaysPresentProperty,
  CODES.strictClosedOpenObject,
  CODES.strictKeywordUndocumented,
  CODES.strictLocalRef,
]);

/** Transformation codes emitted by `compile()`. */
export const TRANSFORMATIONS = {
  renamedInputSchemaField: 'renamed-input-schema-field',
  addedInputSchemaType: 'added-input-schema-type',

  // Strict-mode transformations.
  enabledStrictMode: 'enabled-strict-mode',
  droppedNumericConstraint: 'dropped-numeric-constraint',
  droppedStringConstraint: 'dropped-string-constraint',
  droppedArrayConstraint: 'dropped-array-constraint',
  droppedAdditionalPropertiesSchema: 'dropped-additional-properties-schema',
  closedOpenObject: 'closed-open-object',
  addedAdditionalPropertiesFalse: 'added-additional-properties-false',
  requiredEveryProperty: 'required-every-property',
} as const;


/**
 * Whether a subschema describes a JSON object, and therefore falls under the
 * strict subset's object requirements (`additionalProperties: false`, and every
 * declared property listed in `required`).
 *
 * A schema that declares `properties` without a `type` still describes an
 * object, so both signals count.
 */
export function isObjectSchema(schema: JsonSchema): boolean {
  return (
    isType(schema, 'object') ||
    isPlainObject(schema.properties) ||
    schema.additionalProperties !== undefined
  );
}

/** Per rejected-keyword class: the diagnostic and transformation codes it uses. */
export const STRICT_DROP_CODES = {
  numeric: {
    diagnostic: CODES.strictDropsNumericConstraint,
    transformation: TRANSFORMATIONS.droppedNumericConstraint,
    documentedAs: 'Numerical constraints (such as `minimum`, `maximum`, `multipleOf`)',
  },
  string: {
    diagnostic: CODES.strictDropsStringConstraint,
    transformation: TRANSFORMATIONS.droppedStringConstraint,
    documentedAs: 'String constraints (`minLength`, `maxLength`)',
  },
  array: {
    diagnostic: CODES.strictDropsArrayConstraint,
    transformation: TRANSFORMATIONS.droppedArrayConstraint,
    documentedAs: 'Array constraints beyond `minItems` of 0 or 1',
  },
} as const;
