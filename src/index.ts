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
  CompileOptions,
  CompileResult,
  Diagnostic,
  ProbeOptions,
  ProbeResult,
  SchemaPortProvider,
} from '@schemaport/core';

import { checkTool } from './check.js';
import { compileTool } from './compile.js';
import { probeToolWithAnthropic } from './probe.js';
import {
  API_KEY_ENV_VAR,
  DISPLAY_NAME,
  DOC_REFERENCES,
  PROVIDER_ID,
  RULES_REVIEWED_AT,
} from './rules.js';

export const anthropicProvider: SchemaPortProvider = {
  id: PROVIDER_ID,
  displayName: DISPLAY_NAME,
  rulesReviewedAt: RULES_REVIEWED_AT,
  docs: DOC_REFERENCES,
  apiKeyEnvVar: API_KEY_ENV_VAR,

  check(tool: CanonicalTool): Diagnostic[] {
    return checkTool(tool);
  },

  compile(tool: CanonicalTool, options?: CompileOptions): CompileResult {
    return compileTool(tool, options);
  },

  probe(tool: CanonicalTool, options?: ProbeOptions): Promise<ProbeResult> {
    return probeToolWithAnthropic(tool, options);
  },
};

export default anthropicProvider;

export { checkTool } from './check.js';
export { compileTool } from './compile.js';
export type { AnthropicToolDefinition } from './compile.js';
export { probeToolWithAnthropic } from './probe.js';
export type { AnthropicMessagesClient } from './probe.js';
export {
  CODES,
  DEFAULT_PROBE_MODEL,
  DOC_REFERENCES,
  DOCS,
  PROBE_MODEL_ENV_VAR,
  RULES_REVIEWED_AT,
  TOOL_NAME_PATTERN,
  TRANSFORMATIONS,
} from './rules.js';
