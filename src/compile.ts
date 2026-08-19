import type { CanonicalTool, CompileOptions, CompileResult, JsonSchema, Transformation } from '@schemaport/core';
import { cloneSchema, finalizeCompile, joinPath, schemaTypes, transformation } from '@schemaport/core';

import { checkTool } from './check.js';
import { PROVIDER_ID, TRANSFORMATIONS } from './rules.js';

/**
 * A tool definition in the shape the Messages API `tools` array expects.
 *
 * Field names verified against `@anthropic-ai/sdk` 0.119.0
 * (`Anthropic.Tool`: `name`, `description?`, `input_schema`) and the Messages
 * API reference.
 */
export interface AnthropicToolDefinition {
  name: string;
  description?: string;
  input_schema: JsonSchema;
}

/**
 * Compile a canonical tool into a ready-to-send Anthropic tool definition.
 *
 * No keyword is ever dropped. `input_schema` is typed as an open JSON Schema
 * object by the SDK (`interface InputSchema { type: 'object'; ...; [k: string]: unknown }`)
 * and the Messages API renders it into the tool-use system prompt verbatim, so
 * there is nothing for Anthropic to reject in the default (non-strict) form.
 * Every transformation here is therefore a representation change, never a
 * constraint-destroying one.
 *
 * SchemaPort deliberately does not emit `strict: true`. Strict tool use is the
 * only mode where Anthropic enforces the schema, but its documented subset
 * rejects `minimum`, `maximum`, `multipleOf`, `minLength`, `maxLength` and most
 * array constraints with a 400 — emitting it would mean dropping those
 * keywords, which is lossy. The honest default is the permissive form plus the
 * `anthropic/schema-not-enforced` warning.
 */
export function compileTool(tool: CanonicalTool, options?: CompileOptions): CompileResult {
  const transformations: Transformation[] = [];
  const rootPath = joinPath('inputSchema');

  let inputSchema: JsonSchema = cloneSchema(tool.inputSchema);

  transformations.push(
    transformation(
      TRANSFORMATIONS.renamedInputSchemaField,
      rootPath,
      'Emitted the canonical `inputSchema` as the Messages API field `input_schema`.',
      false,
    ),
  );

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
    transformations.push(
      transformation(
        TRANSFORMATIONS.addedInputSchemaType,
        joinPath(rootPath, 'type'),
        'Added `"type": "object"`, which the Messages API requires on `input_schema`.',
        false,
      ),
    );
  }

  // Key order is fixed at name, description, input_schema so repeated
  // compilations serialize byte-identically.
  const hasDescription = tool.description !== undefined && tool.description.length > 0;
  const output: AnthropicToolDefinition = hasDescription
    ? { name: tool.name, description: tool.description, input_schema: inputSchema }
    : { name: tool.name, input_schema: inputSchema };

  return finalizeCompile({
    providerId: PROVIDER_ID,
    tool,
    output,
    transformations,
    diagnostics: checkTool(tool),
    options,
  });
}
