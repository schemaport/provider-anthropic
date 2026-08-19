import type { CanonicalTool, Diagnostic, JsonSchema } from '@schemaport/core';
import {
  compilable,
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
  NEVER_ENFORCED_KEYWORDS,
  PROVIDER_ID,
  SUPPORTED_MIN_ITEMS,
  TOOL_NAME_MAX_LENGTH,
  TOOL_NAME_PATTERN,
  UNDOCUMENTED_KEYWORDS,
} from './rules.js';

/**
 * Anthropic compatibility rules.
 *
 * Anthropic is the most permissive of SchemaPort's targets: `input_schema` is
 * an arbitrary JSON Schema object that the Messages API renders into the
 * tool-use system prompt verbatim, so nothing has to be dropped. That
 * permissiveness is exactly why most of the rules below are warnings —
 * "accepted" and "enforced" are different things here, and only `strict: true`
 * (which SchemaPort does not emit, see docs/transformations.md) enforces
 * anything at all.
 */
export function checkTool(tool: CanonicalTool): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const rootPath = joinPath('inputSchema');

  const add = (init: Omit<Parameters<typeof diagnostic>[0], 'providerId' | 'toolName'>): void => {
    diagnostics.push(diagnostic({ providerId: PROVIDER_ID, toolName: tool.name, ...init }));
  };

  checkName(tool, add);
  checkDescription(tool, add);
  checkRootType(tool, rootPath, add);
  checkEnforcement(tool, rootPath, add);

  walkSchema(tool.inputSchema, rootPath, ({ schema, path }) => {
    checkSubschema(schema, path, add);
  });

  return sortDiagnostics(diagnostics);
}

type Add = (init: Omit<Parameters<typeof diagnostic>[0], 'providerId' | 'toolName'>) => void;

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
 * `anthropic/schema-not-enforced` — the headline warning.
 *
 * The default Messages API tool-use path does not validate tool inputs. The
 * schema is rendered into the constructed system prompt
 * ("Here are the functions available in JSONSchema format: ..."), and the
 * strict tool use page states plainly that "Without strict mode, Claude might
 * return incompatible types (`"2"` instead of `2`) or omit required fields".
 *
 * Only emitted when the schema actually constrains something, so a genuinely
 * unconstrained tool still reports clean.
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
      'values or omit required properties. Input validation requires `strict: true`, which SchemaPort ' +
      'does not emit because the strict subset rejects several keywords in this schema family.',
    path: rootPath,
    compile: compilable('Emits the default (non-strict) tool definition, preserving the schema verbatim.'),
    docsUrl: DOCS.strictToolUse,
  });
}

/** Per-subschema keyword rules. */
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

  if (Array.isArray(schema.enum) && schema.enum.some((value) => !isPrimitive(value))) {
    add({
      severity: 'warning',
      code: CODES.enumNonPrimitiveValue,
      message:
        '`enum` contains a non-primitive value. Anthropic documents `enum` support for strings, numbers, ' +
        'booleans and nulls only — "no complex types". The values are passed through but are not enforced.',
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
        `(${[...DOCUMENTED_STRING_FORMATS].join(', ')}). It is passed through as prompt text only.`,
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
        'unresolved reference.',
      path: joinPath(path, '$ref'),
      compile: compilable('Preserved verbatim in `input_schema`; SchemaPort does not fetch external documents.'),
      docsUrl: DOCS.jsonSchemaLimitations,
    });
  }
}

function neverEnforced(
  keyword: string,
  path: string,
  extra?: string,
): Omit<Parameters<typeof diagnostic>[0], 'providerId' | 'toolName'> {
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
