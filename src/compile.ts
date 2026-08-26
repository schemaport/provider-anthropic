import type {
  CanonicalTool,
  CompileOptions,
  CompileResult,
  JsonSchema,
  Transformation,
} from '@schemaport/core';
import {
  asSchema,
  cloneSchema,
  finalizeCompile,
  isPlainObject,
  joinPath,
  schemaTypes,
  transformation,
} from '@schemaport/core';

import { checkTool } from './check.js';
import {
  isObjectSchema,
  PROVIDER_ID,
  STRICT_DROP_CODES,
  SUPPORTED_MIN_ITEMS,
  strictRejectedClass,
  TRANSFORMATIONS,
} from './rules.js';

/**
 * A tool definition in the shape the Messages API `tools` array expects.
 *
 * Field names verified against `@anthropic-ai/sdk` 0.119.0
 * (`Anthropic.Tool`: `name`, `description?`, `input_schema`, `strict?`) and the
 * Messages API reference.
 */
export interface AnthropicToolDefinition {
  name: string;
  description?: string;
  input_schema: JsonSchema;
  /**
   * Emitted only by `compile(tool, { strict: true })`. The SDK documents it as
   * "When true, guarantees schema validation on tool names and inputs".
   */
  strict?: true;
}

/**
 * `CompileOptions` plus the one Anthropic-specific knob.
 *
 * Extending rather than replacing keeps `anthropicProvider` assignable to
 * `SchemaPortProvider`: every field is optional, so a caller holding the shared
 * `CompileOptions` type still compiles.
 */
export interface AnthropicCompileOptions extends CompileOptions {
  /**
   * Emit `strict: true` and reduce the schema to Anthropic's strict subset.
   *
   * Off by default. Turning it on buys enforcement and costs constraints: every
   * keyword the strict subset rejects is dropped, each drop is a lossy
   * transformation, and compilation is therefore refused unless `allowLossy` is
   * also set. See `docs/limitations.md`.
   */
  strict?: boolean;
}

interface Context {
  transformations: Transformation[];
}

function record(ctx: Context, code: string, path: string, detail: string, lossy: boolean): void {
  ctx.transformations.push(transformation(code, path, detail, lossy));
}

/* -------------------------------------------------------------------------- */
/* Strict subset                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Rewrite one subschema into Anthropic's strict subset.
 *
 * Only the keywords the JSON Schema limitations page lists under
 * "Not supported" are dropped — nothing else. Keywords the page does not
 * mention at all (`oneOf`, `not`, `prefixItems`, `minProperties`,
 * `maxProperties`, `pattern`) are *kept*: absence from a list is not a
 * documented rejection, and dropping a keyword on a guess would destroy a
 * constraint for a reason SchemaPort cannot cite. `check()` reports them as
 * uncertain instead (`anthropic/strict-keyword-undocumented`).
 *
 * Keys are copied in source order and the object rules append at the end, so
 * repeated compilations serialize byte-identically.
 */
function toStrictSchema(schema: JsonSchema, path: string, ctx: Context): JsonSchema {
  // Built as a bare record so that copying a keyword verbatim never has to
  // satisfy `JsonSchema`'s declared types; the result is a JSON Schema object.
  const out: Record<string, unknown> = {};
  const objectSchema = isObjectSchema(schema);

  for (const [keyword, value] of Object.entries(schema)) {
    const at = joinPath(path, keyword);

    // `additionalProperties` and `required` are settled by `closeObject`.
    if (objectSchema && (keyword === 'additionalProperties' || keyword === 'required')) {
      if (keyword === 'required') out['required'] = value;
      continue;
    }

    const rejected = strictRejectedClass(keyword);
    if (rejected !== undefined) {
      const codes = STRICT_DROP_CODES[rejected];
      record(
        ctx,
        codes.transformation,
        at,
        `Dropped \`${keyword}\`; Anthropic's strict subset lists "${codes.documentedAs}" as not supported and returns a 400. The constraint is no longer expressed.`,
        true,
      );
      continue;
    }

    if (keyword === 'minItems' && typeof value === 'number' && !SUPPORTED_MIN_ITEMS.has(value)) {
      record(
        ctx,
        STRICT_DROP_CODES.array.transformation,
        at,
        `Dropped \`minItems: ${String(value)}\`; the strict subset supports only \`minItems\` of 0 or 1. The array may now be empty.`,
        true,
      );
      continue;
    }

    out[keyword] = transformKeyword(keyword, value, path, ctx);
  }

  if (objectSchema) closeObject(out, schema, path, ctx);

  return out as JsonSchema;
}

/** Recurse into every schema-valued slot that survives strict compilation. */
function transformKeyword(keyword: string, value: unknown, path: string, ctx: Context): unknown {
  switch (keyword) {
    case 'properties':
    case '$defs':
    case 'definitions': {
      if (!isPlainObject(value)) return value;
      const map: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value)) {
        const sub = asSchema(child);
        map[key] = sub ? toStrictSchema(sub, joinPath(path, keyword, key), ctx) : child;
      }
      return map;
    }
    case 'items':
    case 'not': {
      const sub = asSchema(value);
      return sub ? toStrictSchema(sub, joinPath(path, keyword), ctx) : value;
    }
    case 'anyOf':
    case 'oneOf':
    case 'allOf':
    case 'prefixItems': {
      if (!Array.isArray(value)) return value;
      return value.map((branch, index) => {
        const sub = asSchema(branch);
        return sub ? toStrictSchema(sub, joinPath(path, keyword, index), ctx) : branch;
      });
    }
    default:
      return value;
  }
}

/**
 * Apply the strict subset's two object requirements: `additionalProperties`
 * set to `false`, and every declared property listed in `required`.
 *
 * Closing an object that declared nothing about extra keys is a representation
 * change — the canonical schema was already closed in practice — so it is not
 * lossy. Replacing a *typed* `additionalProperties` map with `false` destroys a
 * documented capability of the tool and is recorded lossy, matching how the
 * OpenAI provider classifies the same rewrite.
 */
function closeObject(
  out: Record<string, unknown>,
  schema: JsonSchema,
  path: string,
  ctx: Context,
): void {
  const properties = isPlainObject(schema.properties) ? schema.properties : {};
  const declared = Object.keys(properties);
  const canonicalRequired = Array.isArray(schema.required) ? schema.required : [];

  if (declared.length > 0) {
    const added = declared.filter((name) => !canonicalRequired.includes(name));
    if (added.length > 0) {
      const merged = [...canonicalRequired];
      for (const name of declared) if (!merged.includes(name)) merged.push(name);
      out['required'] = merged;
      record(
        ctx,
        TRANSFORMATIONS.requiredEveryProperty,
        joinPath(path, 'required'),
        `Listed ${added.map((name) => `\`${name}\``).join(', ')} in \`required\`; the strict subset has no optional properties. The model must now always send ${added.length === 1 ? 'it' : 'them'}.`,
        false,
      );
    }
  }

  const additional = schema.additionalProperties;
  if (additional === undefined) {
    record(
      ctx,
      TRANSFORMATIONS.addedAdditionalPropertiesFalse,
      joinPath(path, 'additionalProperties'),
      'Added `additionalProperties: false`, which the strict subset requires on every object. The canonical schema declared no extra keys, so nothing it accepted is lost.',
      false,
    );
  } else if (additional === true) {
    record(
      ctx,
      TRANSFORMATIONS.closedOpenObject,
      joinPath(path, 'additionalProperties'),
      'Replaced `additionalProperties: true` with `false`; the strict subset accepts no other value. Undeclared keys are no longer allowed.',
      false,
    );
  } else if (additional !== false) {
    record(
      ctx,
      TRANSFORMATIONS.droppedAdditionalPropertiesSchema,
      joinPath(path, 'additionalProperties'),
      'Replaced the `additionalProperties` value schema with `false`; the strict subset accepts no other value. The open typed map is gone.',
      true,
    );
  }

  out['additionalProperties'] = false;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Compile a canonical tool into a ready-to-send Anthropic tool definition.
 *
 * **Default (`strict` off).** No keyword is ever dropped. `input_schema` is
 * typed as an open JSON Schema object by the SDK
 * (`interface InputSchema { type: 'object'; ...; [k: string]: unknown }`) and
 * the Messages API renders it into the tool-use system prompt verbatim, so
 * there is nothing for Anthropic to reject. Every transformation is a
 * representation change, never a constraint-destroying one — and nothing is
 * enforced either, which `anthropic/schema-not-enforced` reports.
 *
 * **`{ strict: true }`.** Emits `strict: true`, which is the only mode where
 * Anthropic validates tool inputs. The documented strict subset rejects
 * numerical constraints, string constraints, array constraints beyond
 * `minItems` of 0 or 1, and any `additionalProperties` other than `false` with
 * a 400, so those are dropped. Each drop is a lossy transformation, so a schema
 * carrying any of them is refused unless the caller also passes `allowLossy` —
 * the refusal itself is `finalizeCompile`'s, not this adapter's.
 */
export function compileTool(tool: CanonicalTool, options?: AnthropicCompileOptions): CompileResult {
  const strict = options?.strict ?? false;
  const ctx: Context = { transformations: [] };
  const rootPath = joinPath('inputSchema');

  let inputSchema: JsonSchema = cloneSchema(tool.inputSchema);

  record(
    ctx,
    TRANSFORMATIONS.renamedInputSchemaField,
    rootPath,
    'Emitted the canonical `inputSchema` as the Messages API field `input_schema`.',
    false,
  );

  if (strict) {
    record(
      ctx,
      TRANSFORMATIONS.enabledStrictMode,
      rootPath,
      'Emitted `strict: true`, so Anthropic validates tool inputs against the schema instead of treating it as prompt guidance.',
      false,
    );
  }

  if (schemaTypes(inputSchema).length === 0) {
    // Built key by key rather than spread over a literal: an explicit
    // `type: undefined` key survives structuredClone and a spread would
    // overwrite the added type back to undefined.
    const typed: JsonSchema = { type: 'object' };
    for (const [keyword, value] of Object.entries(inputSchema)) {
      if (keyword === 'type') continue;
      typed[keyword] = value;
    }
    inputSchema = typed;
    record(
      ctx,
      TRANSFORMATIONS.addedInputSchemaType,
      joinPath(rootPath, 'type'),
      'Added `"type": "object"`, which the Messages API requires on `input_schema`.',
      false,
    );
  }

  if (strict) inputSchema = toStrictSchema(inputSchema, rootPath, ctx);

  // Key order is fixed at name, description, input_schema, strict so repeated
  // compilations serialize byte-identically.
  const hasDescription = tool.description !== undefined && tool.description.length > 0;
  const output: AnthropicToolDefinition = {
    name: tool.name,
    ...(hasDescription ? { description: tool.description } : {}),
    input_schema: inputSchema,
    ...(strict ? { strict: true as const } : {}),
  };

  return finalizeCompile({
    providerId: PROVIDER_ID,
    tool,
    output,
    transformations: ctx.transformations,
    diagnostics: checkTool(tool, { strict }),
    options,
  });
}
