/**
 * `@schemaport/provider-anthropic`
 *
 * Compatibility checks, compilation and live probing for Anthropic Messages
 * API tool definitions.
 *
 * Rules were reviewed against the official documentation listed in
 * `DOC_REFERENCES` on the date in `rulesReviewedAt`, and against
 * `@anthropic-ai/sdk` 0.119.0.
 */

import type {
  CanonicalTool,
  CompileResult,
  Diagnostic,
  ProbeResult,
  SchemaPortProvider,
} from '@schemaport/core';

import { checkTool } from './check.js';
import type { AnthropicCheckOptions } from './check.js';
import { compileTool } from './compile.js';
import type { AnthropicCompileOptions } from './compile.js';
import { probeToolWithAnthropic } from './probe.js';
import type { AnthropicProbeOptions } from './probe.js';
import {
  API_KEY_ENV_VAR,
  DISPLAY_NAME,
  DOC_REFERENCES,
  PROVIDER_ID,
  RULES_REVIEWED_AT,
} from './rules.js';

/**
 * The shared provider contract, widened with Anthropic's own options.
 *
 * Every added option is optional, so this type is a structural subtype of
 * `SchemaPortProvider`: the CLI keeps working against the shared contract while
 * a caller who knows they are talking to Anthropic can write
 * `anthropicProvider.compile(tool, { strict: true })` and have it typecheck.
 * `@schemaport/core` owns `CompileOptions` and is not modified.
 */
export interface AnthropicProvider extends SchemaPortProvider {
  check(tool: CanonicalTool, options?: AnthropicCheckOptions): Diagnostic[];
  compile(tool: CanonicalTool, options?: AnthropicCompileOptions): CompileResult;
  probe(tool: CanonicalTool, options?: AnthropicProbeOptions): Promise<ProbeResult>;
}

export const anthropicProvider: AnthropicProvider = {
  id: PROVIDER_ID,
  displayName: DISPLAY_NAME,
  rulesReviewedAt: RULES_REVIEWED_AT,
  docs: DOC_REFERENCES,
  apiKeyEnvVar: API_KEY_ENV_VAR,

  check(tool: CanonicalTool, options?: AnthropicCheckOptions): Diagnostic[] {
    return checkTool(tool, options);
  },

  compile(tool: CanonicalTool, options?: AnthropicCompileOptions): CompileResult {
    return compileTool(tool, options);
  },

  probe(tool: CanonicalTool, options?: AnthropicProbeOptions): Promise<ProbeResult> {
    return probeToolWithAnthropic(tool, options);
  },
};

/**
 * Compile-time proof that the widened provider still satisfies the contract the
 * CLI consumes. If an added option ever stopped being optional, this breaks.
 */
const _contract: SchemaPortProvider = anthropicProvider;
void _contract;

export default anthropicProvider;

export { checkTool } from './check.js';
export type { AnthropicCheckOptions } from './check.js';
export { compileTool } from './compile.js';
export type { AnthropicCompileOptions, AnthropicToolDefinition } from './compile.js';
export { probeToolWithAnthropic } from './probe.js';
export type { AnthropicMessagesClient, AnthropicProbeOptions } from './probe.js';
export {
  CODES,
  DEFAULT_PROBE_MODEL,
  DOC_REFERENCES,
  DOCS,
  PROBE_MODEL_ENV_VAR,
  RULES_REVIEWED_AT,
  STRICT_DROPPED_KEYWORDS,
  STRICT_ONLY_CODES,
  STRICT_REJECTED_KEYWORDS,
  TOOL_NAME_PATTERN,
  TRANSFORMATIONS,
} from './rules.js';
