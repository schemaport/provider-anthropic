import type { CanonicalTool, Diagnostic, JsonSchema } from '@schemaport/core';
import {
  compilable,
  compilableLossy,
  diagnostic,
  isPlainObject,
  joinPath,
  notCompilable,
  schemaTypes,
  sortDiagnostics,
  walkSchema,
} from '@schemaport/core';

import {
  CODES,
  DOCS,
  DOCUMENTED_STRING_FORMATS,
  isObjectSchema,
  NEVER_ENFORCED_KEYWORDS,
  PROVIDER_ID,
  STRICT_DROP_CODES,
  strictRejectedClass,
  SUPPORTED_MIN_ITEMS,
  TOOL_NAME_MAX_LENGTH,
  TOOL_NAME_PATTERN,
  UNDOCUMENTED_KEYWORDS,
} from './rules.js';

/**
 * Options that put `check()` into the strict context.
 *
 * `check(tool)` with no options describes the default, non-strict tool
 * definition and is unchanged from before strict mode existed. `compile()`
 * passes `{ strict: true }` through when the caller asked for a strict tool, so
 * the diagnostics in a strict compile result describe the strict subset rather
 * than the permissive one.
 */
export interface AnthropicCheckOptions {
  strict?: boolean;
}

/**
 * Anthropic compatibility rules.
 *
 * The two modes are genuinely different targets and the rules split along that
 * line:
 *
 * - **Default.** `input_schema` is an arbitrary JSON Schema object that the
 *   Messages API renders into the tool-use system prompt verbatim, so nothing
 *   has to be dropped — and nothing is enforced either. Most rules here are
 *   warnings because "accepted" and "enforced" are different things.
 * - **`strict: true`.** Anthropic validates tool inputs, but only over the
 *   documented subset: numerical constraints, string constraints, array
 *   constraints beyond `minItems` of 0 or 1 and any `additionalProperties`
 *   other than `false` are rejected with a 400, so compilation drops them.
 *   Every drop is an error whose fix is lossy.
 */
export function checkTool(tool: CanonicalTool, options?: AnthropicCheckOptions): Diagnostic[] {
  const strict = options?.strict ?? false;
  const diagnostics: Diagnostic[] = [];
  const rootPath = joinPath('inputSchema');

  const add = (init: Omit<Parameters<typeof diagnostic>[0], 'providerId' | 'toolName'>): void => {
    diagnostics.push(diagnostic({ providerId: PROVIDER_ID, toolName: tool.name, ...init }));
  };

  checkName(tool, add);
  checkDescription(tool, add);
  checkRootType(tool, rootPath, add);
  if (!strict) checkEnforcement(tool, rootPath, add);

  walkSchema(tool.inputSchema, rootPath, ({ schema, path }) => {
    if (strict) checkStrictSubschema(schema, path, add);
    else checkSubschema(schema, path, add);
    checkSharedSubschema(schema, path, strict, add);
  });

  return sortDiagnostics(diagnostics);
}

type Add = (init: Omit<Parameters<typeof diagnostic>[0], 'providerId' | 'toolName'>) => void;
type DiagnosticInit = Omit<Parameters<typeof diagnostic>[0], 'providerId' | 'toolName'>;

/** `anthropic/invalid-tool-name` — Define tools: `name` must match `^[a-zA-Z0-9_-]{1,64}$`. */
function checkName(tool: CanonicalTool, add: Add): void {
  if (TOOL_NAME_PATTERN.test(tool.name)) return;

  const reason =
    tool.name.length > TOOL_NAME_MAX_LENGTH
      ? `it is ${String(tool.name.length)} characters long (the limit is ${String(TOOL_NAME_MAX_LENGTH)})`
      : 'it contains characters outside `A-Z a-z 0-9 _ -`';

  add({
    severity: 'error',
    code: CODES.invalidToolName,
    message:
      `Tool name \`${tool.name}\` is rejected by the Messages API because ${reason}. ` +
      'Tool names must match `^[a-zA-Z0-9_-]{1,64}$`.',
    path: joinPath('name'),
    compile: notCompilable(
      'Refused: renaming a tool would change the identity your code dispatches on. Rename it in the source schema.',
    ),
    docsUrl: DOCS.defineTools,
  });
}

/** `anthropic/missing-tool-description` — Define tools calls the description the single biggest factor in tool performance. */
function checkDescription(tool: CanonicalTool, add: Add): void {
  if (tool.description !== undefined && tool.description.trim().length > 0) return;

  add({
    severity: 'info',
    code: CODES.missingToolDescription,
    message:
      'No tool description. Anthropic documents the description as "by far the most important factor in tool performance" ' +
      'and recommends at least 3-4 sentences.',
    path: joinPath('description'),
    compile: compilable('Omits the `description` field, which the Messages API treats as optional.'),
    docsUrl: DOCS.defineTools,
  });
}

/**
 * `anthropic/missing-input-schema-type` / `anthropic/input-schema-not-object` —
 * the Messages API types `input_schema.type` as the literal `"object"`.
 */
function checkRootType(tool: CanonicalTool, rootPath: string, add: Add): void {
  const types = schemaTypes(tool.inputSchema);

  if (types.length === 0) {
    add({
      severity: 'error',
      code: CODES.missingInputSchemaType,
      message:
        'The root input schema declares no `type`. The Messages API requires `input_schema.type` to be `"object"`.',
      path: joinPath(rootPath, 'type'),
      compile: compilable('Adds `"type": "object"` to the compiled `input_schema`.'),
      docsUrl: DOCS.messagesApi,
    });
    return;
  }

  if (types.length === 1 && types[0] === 'object') return;

  add({
    severity: 'error',
    code: CODES.inputSchemaNotObject,
    message:
      `The root input schema declares type \`${types.join(' | ')}\`. ` +
      'The Messages API only accepts `"type": "object"` for `input_schema`.',
    path: joinPath(rootPath, 'type'),
    compile: notCompilable(
      'Refused: rewriting the root type would change what arguments the tool takes.',
    ),
    docsUrl: DOCS.messagesApi,
  });
}

/**
 * `anthropic/schema-not-enforced` — the headline warning for the default form.
 *
 * The default Messages API tool-use path does not validate tool inputs. The
 * schema is rendered into the constructed system prompt
 * ("Here are the functions available in JSONSchema format: ..."), and the
 * strict tool use page states plainly that "Without strict mode, Claude might
 * return incompatible types (`"2"` instead of `2`) or omit required fields".
 *
 * Only emitted when the schema actually constrains something, so a genuinely
 * unconstrained tool still reports clean — and never emitted in the strict
 * context, where the statement would simply be false.
 */
function checkEnforcement(tool: CanonicalTool, rootPath: string, add: Add): void {
  const properties = tool.inputSchema.properties;
  const hasProperties = isPlainObject(properties) && Object.keys(properties).length > 0;
  const hasRequired = Array.isArray(tool.inputSchema.required) && tool.inputSchema.required.length > 0;
  if (!hasProperties && !hasRequired) return;

  add({
    severity: 'warning',
    code: CODES.schemaNotEnforced,
    message:
      'Anthropic accepts this schema in full but does not validate tool inputs against it by default. ' +
      'The schema is rendered into the tool-use system prompt as guidance, so Claude may return mistyped ' +
      'values or omit required properties. Input validation requires `strict: true`, which SchemaPort can ' +
      'emit with `compile(tool, { strict: true })` — at the cost of dropping every keyword the strict ' +
      'subset rejects.',
    path: rootPath,
    compile: compilable('Emits the default (non-strict) tool definition, preserving the schema verbatim.'),
    docsUrl: DOCS.strictToolUse,
  });
}

/* -------------------------------------------------------------------------- */
/* Per-subschema rules                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Rules for keywords compilation preserves in **both** modes.
 *
 * All three are cases the documentation describes as outside the supported set
 * without saying the request is rejected, so strict compilation keeps them
 * rather than dropping them on a guess. The strict wording adds the one thing
 * that does change: an unsupported feature is documented to return a 400, so
 * the request may be refused.
 */
function checkSharedSubschema(schema: JsonSchema, path: string, strict: boolean, add: Add): void {
  const strictRisk = strict
    ? ' Under `strict: true` Anthropic may reject the request with a 400 instead; SchemaPort keeps the keyword rather than dropping it, because the documentation does not say it is rejected.'
    : '';

  if (Array.isArray(schema.enum) && schema.enum.some((value) => !isPrimitive(value))) {
    add({
      severity: 'warning',
      code: CODES.enumNonPrimitiveValue,
      message:
        '`enum` contains a non-primitive value. Anthropic documents `enum` support for strings, numbers, ' +
        'booleans and nulls only — "no complex types". The values are passed through but are not enforced.' +
        strictRisk,
      path: joinPath(path, 'enum'),
      compile: compilable('Preserved verbatim in `input_schema`.'),
      docsUrl: DOCS.jsonSchemaLimitations,
    });
  }

  if (typeof schema.format === 'string' && !DOCUMENTED_STRING_FORMATS.has(schema.format)) {
    add({
      severity: 'warning',
      code: CODES.undocumentedStringFormat,
      message:
        `String format \`${schema.format}\` is outside Anthropic's documented set ` +
        `(${[...DOCUMENTED_STRING_FORMATS].join(', ')}). It is passed through as prompt text only.` +
        strictRisk,
      path: joinPath(path, 'format'),
      compile: compilable('Preserved verbatim in `input_schema`.'),
      docsUrl: DOCS.jsonSchemaLimitations,
    });
  }

  if (typeof schema.$ref === 'string' && !schema.$ref.startsWith('#')) {
    add({
      severity: 'warning',
      code: CODES.externalRef,
      message:
        `\`$ref\` targets \`${schema.$ref}\`, which is outside this document. Anthropic documents external ` +
        '`$ref` as not supported, and nothing resolves it in default tool use — the model only sees the ' +
        'unresolved reference.' +
        strictRisk,
      path: joinPath(path, '$ref'),
      compile: compilable('Preserved verbatim in `input_schema`; SchemaPort does not fetch external documents.'),
      docsUrl: DOCS.jsonSchemaLimitations,
    });
  }
}

/** Per-subschema rules for the default, non-strict tool definition. */
function checkSubschema(schema: JsonSchema, path: string, add: Add): void {
  for (const keyword of NEVER_ENFORCED_KEYWORDS) {
    if (schema[keyword] === undefined) continue;
    add(neverEnforced(keyword, joinPath(path, keyword)));
  }

  const minItems = schema.minItems;
  if (typeof minItems === 'number' && !SUPPORTED_MIN_ITEMS.has(minItems)) {
    add(neverEnforced('minItems', joinPath(path, 'minItems'), 'only the values 0 and 1 are supported'));
  }

  const additional = schema.additionalProperties;
  if (additional !== undefined && additional !== false) {
    add(
      neverEnforced(
        'additionalProperties',
        joinPath(path, 'additionalProperties'),
        'only `additionalProperties: false` is supported',
      ),
    );
  }

  for (const keyword of UNDOCUMENTED_KEYWORDS) {
    if (schema[keyword] === undefined) continue;
    add({
      severity: 'warning',
      code: CODES.keywordNotDocumented,
      message:
        `\`${keyword}\` is not documented as supported by Anthropic. It appears in neither the supported ` +
        'nor the unsupported list of the JSON Schema limitations page, so SchemaPort cannot promise it is ' +
        'honoured. It is passed through unchanged and is not enforced in default tool use.',
      path: joinPath(path, keyword),
      compile: compilable('Preserved verbatim in `input_schema`.'),
      docsUrl: DOCS.jsonSchemaLimitations,
    });
  }
}

/**
 * Per-subschema rules for `strict: true`.
 *
 * Everything the JSON Schema limitations page lists under "Not supported"
 * becomes an `error` whose fix is lossy: strict compilation has to drop the
 * keyword, and `finalizeCompile` then refuses the compile unless the caller
 * passed `allowLossy`. Keywords the page does not mention are *not* dropped —
 * they get an uncertainty warning instead.
 */
function checkStrictSubschema(schema: JsonSchema, path: string, add: Add): void {
  for (const keyword of NEVER_ENFORCED_KEYWORDS) {
    if (schema[keyword] === undefined) continue;
    const rejected = strictRejectedClass(keyword);
    if (rejected === undefined) continue;
    add(strictDropsConstraint(keyword, rejected, joinPath(path, keyword)));
  }

  const minItems = schema.minItems;
  if (typeof minItems === 'number' && !SUPPORTED_MIN_ITEMS.has(minItems)) {
    add(
      strictDropsConstraint(
        'minItems',
        'array',
        joinPath(path, 'minItems'),
        `\`minItems: ${String(minItems)}\` is outside the supported values 0 and 1.`,
      ),
    );
  }

  checkStrictObject(schema, path, add);

  for (const keyword of UNDOCUMENTED_KEYWORDS) {
    if (schema[keyword] === undefined) continue;
    add({
      severity: 'warning',
      code: CODES.strictKeywordUndocumented,
      message:
        `\`${keyword}\` appears in neither the supported nor the unsupported list of the JSON Schema ` +
        'limitations page, so SchemaPort cannot tell you whether `strict: true` honours it. It is kept in ' +
        'the compiled schema rather than dropped on a guess — but the page says an unsupported feature ' +
        'returns "a 400 error with details", so this request may be rejected. Uncertain, not a guarantee.',
      path: joinPath(path, keyword),
      compile: compilable('Preserved verbatim in `input_schema`; SchemaPort will not drop a keyword Anthropic does not document as rejected.'),
      docsUrl: DOCS.jsonSchemaLimitations,
    });
  }

  if (typeof schema.$ref === 'string' && schema.$ref.startsWith('#')) {
    add({
      severity: 'warning',
      code: CODES.strictLocalRef,
      message:
        `\`$ref\` targets \`${schema.$ref}\`. Local references are documented as supported, but recursive ` +
        'schemas are documented as *un*supported under `strict: true`. SchemaPort does not resolve `$ref`, ' +
        'so it cannot confirm this schema is not recursive; if it is, Anthropic returns a 400. Verify it ' +
        'yourself or probe the tool.',
      path: joinPath(path, '$ref'),
      compile: compilable('Preserved verbatim in `input_schema`; SchemaPort does not inline or resolve references.'),
      docsUrl: DOCS.strictToolUse,
    });
  }
}

/**
 * The strict subset's object requirements.
 *
 * `additionalProperties: false` is documented, and follows the two-diagnostic
 * pattern: an `error` saying the canonical schema cannot be sent as written,
 * which disappears once compile has worked around it, and a `warning` recording
 * what changed at runtime, which survives into the compile result.
 *
 * Listing every declared property in `required` is **not** documented — see the
 * message below. It is a choice this package makes, so it gets a plain warning
 * and no error: claiming Anthropic rejects an optional property would be a
 * guarantee SchemaPort cannot cite.
 */
function checkStrictObject(schema: JsonSchema, path: string, add: Add): void {
  if (!isObjectSchema(schema)) return;

  const properties = isPlainObject(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];

  for (const name of Object.keys(properties)) {
    if (required.includes(name)) continue;

    add({
      severity: 'warning',
      code: CODES.strictAlwaysPresentProperty,
      message:
        `Strict compilation lists \`${name}\` in \`required\`, so the model must always send it — callers ` +
        'that treated its absence as meaningful will now always receive a value. Be aware this is ' +
        "SchemaPort's own choice, not a documented Anthropic rule: the object requirement SchemaPort can " +
        'cite for the strict subset is `additionalProperties: false`, and no reviewed page says an optional ' +
        'property is rejected. It is applied because the strict subset has no documented way to express ' +
        'optionality — treat that as uncertain, not as a guarantee.',
      path: joinPath(path, 'properties', name),
      compile: compilable(`Emits \`${name}\` as required; it is never omitted.`),
      docsUrl: DOCS.jsonSchemaLimitations,
    });
  }

  const additional = schema.additionalProperties;
  if (additional === undefined || additional === false) return;

  const at = joinPath(path, 'additionalProperties');
  if (additional === true) {
    add({
      severity: 'error',
      code: CODES.strictDropsAdditionalProperties,
      message:
        '`additionalProperties: true` is rejected by the strict subset, which documents ' +
        '"`additionalProperties` set to anything other than `false`" as not supported.',
      path: at,
      compile: compilable('Replaces `additionalProperties: true` with `false`.'),
      docsUrl: DOCS.jsonSchemaLimitations,
    });
    add({
      severity: 'warning',
      code: CODES.strictClosedOpenObject,
      message:
        'After strict compilation this object is closed: undeclared keys are rejected instead of accepted. ' +
        'The canonical schema allowed them.',
      path: at,
      compile: compilable('Emits `additionalProperties: false`; undeclared keys are rejected.'),
      docsUrl: DOCS.jsonSchemaLimitations,
    });
    return;
  }

  add({
    severity: 'error',
    code: CODES.strictDropsAdditionalProperties,
    message:
      'A typed `additionalProperties` schema is rejected by the strict subset, which documents ' +
      '"`additionalProperties` set to anything other than `false`" as not supported. The open typed map ' +
      'cannot be expressed under `strict: true`.',
    path: at,
    compile: compilableLossy(
      'Replaces the value schema with `additionalProperties: false`, dropping the open typed map.',
    ),
    docsUrl: DOCS.jsonSchemaLimitations,
  });
}

function strictDropsConstraint(
  keyword: string,
  rejected: 'numeric' | 'string' | 'array',
  path: string,
  extra?: string,
): DiagnosticInit {
  const codes = STRICT_DROP_CODES[rejected];
  return {
    severity: 'error',
    code: codes.diagnostic,
    message:
      `\`${keyword}\` is rejected by Anthropic's strict subset, which lists "${codes.documentedAs}" ` +
      'as not supported — an unsupported feature returns "a 400 error with details"' +
      (extra === undefined ? '' : `. ${extra}`) +
      '. Strict compilation drops the keyword, so the constraint stops being expressed at all.',
    path,
    compile: compilableLossy(`Drops \`${keyword}\`; the constraint is gone from the compiled schema.`),
    docsUrl: DOCS.jsonSchemaLimitations,
  };
}

function neverEnforced(keyword: string, path: string, extra?: string): DiagnosticInit {
  return {
    severity: 'warning',
    code: CODES.constraintNotEnforced,
    message:
      `\`${keyword}\` is never enforced by Anthropic. It is ignored in default tool use, and it is on the ` +
      'documented "Not supported" list for `strict: true`' +
      (extra === undefined ? '' : ` (${extra})`) +
      ', which returns a 400 rather than enforcing it. The keyword is preserved in the compiled schema, ' +
      'but treat it as documentation for the model, not a guarantee.',
    path,
    compile: compilable('Preserved verbatim in `input_schema`.'),
    docsUrl: DOCS.jsonSchemaLimitations,
  };
}

function isPrimitive(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}
