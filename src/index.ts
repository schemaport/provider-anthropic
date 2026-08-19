import type {
  CanonicalTool,
  CompileOptions,
  CompileResult,
  Diagnostic, ProbeOptions, ProbeResult,
  SchemaPortProvider,
} from "@schemaport/core";
import { finalizeCompile, probeSkipped } from "@schemaport/core";

const ID = "anthropic";

/**
 * PLACEHOLDER. Replaced by the Anthropic implementation.
 */
export const anthropicProvider: SchemaPortProvider = {
  id: ID,
  displayName: "Anthropic",
  rulesReviewedAt: "2026-08-20",
  docs: [],
  apiKeyEnvVar: "ANTHROPIC_API_KEY",
  check(_tool: CanonicalTool): Diagnostic[] {
    return [];
  },
  compile(tool: CanonicalTool, options?: CompileOptions): CompileResult {
    return finalizeCompile({
      providerId: ID,
      tool,
      output: { name: tool.name, description: tool.description, inputSchema: tool.inputSchema },
      transformations: [],
      diagnostics: [],
      options,
    });
  },
  async probe(tool: CanonicalTool, _options?: ProbeOptions): Promise<ProbeResult> {
    return probeSkipped({ providerId: ID, toolName: tool.name }, "Not implemented yet.");
  },
};

export default anthropicProvider;
