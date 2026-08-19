import type { CanonicalTool, ProbeOptions, ProbeResult } from '@schemaport/core';
import {
  classifyProviderError,
  probeAccepted,
  probeCompileRefused,
  probeError,
  probeMissingCredentials,
  probePrompt,
  probeRejected,
  resolveApiKey,
  resolveProbeModel,
} from '@schemaport/core';
import Anthropic from '@anthropic-ai/sdk';

import { compileTool } from './compile.js';
import {
  API_KEY_ENV_VAR,
  DEFAULT_PROBE_MODEL,
  PROBE_MAX_TOKENS,
  PROBE_MODEL_ENV_VAR,
  PROVIDER_ID,
} from './rules.js';

/**
 * The slice of the Anthropic SDK the probe uses.
 *
 * Declared structurally so `options.client` can be any object with a
 * `messages.create`, and tests never need a full SDK instance.
 */
export interface AnthropicMessagesClient {
  messages: {
    create(body: unknown, options?: unknown): Promise<unknown>;
  };
}

interface MessageResponseShape {
  stop_reason?: string | null;
  content?: unknown;
}

interface ToolUseBlockShape {
  type?: unknown;
  name?: unknown;
  input?: unknown;
}

/**
 * Send the smallest request that answers "does Anthropic accept this tool?".
 *
 * The developer's function is never executed: the probe asks the model for one
 * synthetic call with placeholder values and inspects the arguments. Core then
 * validates them against the *canonical* schema, which is what makes
 * Anthropic's lack of default enforcement observable rather than theoretical.
 */
export async function probeToolWithAnthropic(
  tool: CanonicalTool,
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  const base = { providerId: PROVIDER_ID, toolName: tool.name };

  const compiled = compileTool(tool, { allowLossy: options.allowLossy ?? false });
  if (!compiled.ok || compiled.output === undefined) {
    return probeCompileRefused(base, compiled);
  }

  const model = resolveProbeModel(options.model, PROBE_MODEL_ENV_VAR, DEFAULT_PROBE_MODEL);

  let client: AnthropicMessagesClient;
  if (options.client !== undefined) {
    client = options.client as AnthropicMessagesClient;
  } else {
    const apiKey = resolveApiKey(options.apiKey, API_KEY_ENV_VAR);
    if (apiKey === undefined) return probeMissingCredentials(base, API_KEY_ENV_VAR);
    client = new Anthropic({ apiKey }) as unknown as AnthropicMessagesClient;
  }

  const request = {
    model,
    max_tokens: PROBE_MAX_TOKENS,
    messages: [{ role: 'user', content: probePrompt(tool) }],
    tools: [compiled.output],
    tool_choice: { type: 'tool', name: tool.name },
  };

  let response: MessageResponseShape;
  try {
    const raw =
      options.timeoutMs === undefined
        ? await client.messages.create(request)
        : await client.messages.create(request, { timeout: options.timeoutMs });
    response = (raw ?? {}) as MessageResponseShape;
  } catch (error) {
    const { kind, detail } = classifyProviderError(error);
    if (kind === 'rejected') return probeRejected(base, model, detail);
    return probeError(base, kind, detail, model);
  }

  // A response truncated at max_tokens can carry a half-written tool input.
  // Reporting those partial arguments would look identical to "Anthropic
  // ignored the schema", so they are not inspected at all.
  if (response.stop_reason === 'max_tokens') {
    return probeAccepted({
      ...base,
      model,
      tool,
      notes: ['The response hit `max_tokens`, so the tool-call arguments were not inspected.'],
    });
  }

  if (response.stop_reason === 'refusal') {
    return probeAccepted({
      ...base,
      model,
      tool,
      notes: ['The model declined to answer, so no tool call was produced. The schema itself was accepted.'],
    });
  }

  const toolInput = findToolInput(response, tool.name);
  if (toolInput === undefined) {
    return probeAccepted({ ...base, model, tool });
  }

  return probeAccepted({ ...base, model, tool, argumentsReceived: toolInput });
}

function findToolInput(response: MessageResponseShape, toolName: string): unknown {
  if (!Array.isArray(response.content)) return undefined;
  for (const block of response.content) {
    if (typeof block !== 'object' || block === null) continue;
    const candidate = block as ToolUseBlockShape;
    if (candidate.type !== 'tool_use') continue;
    if (typeof candidate.name === 'string' && candidate.name !== toolName) continue;
    return candidate.input;
  }
  return undefined;
}
