import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { minimalTool, refundOrderTool } from '@schemaport/core';

import { DEFAULT_PROBE_MODEL, PROBE_MODEL_ENV_VAR, anthropicProvider } from '../src/index.js';
import { dottedNameTool } from './fixtures.js';

/**
 * No test here touches the network. `options.client` is the seam: every case
 * passes a stub with a `messages.create` and asserts on what the adapter sent.
 */

interface Recorded {
  body: Record<string, unknown>;
  options?: unknown;
}

function stubClient(handler: () => unknown): { calls: Recorded[]; messages: { create: (body: unknown, options?: unknown) => Promise<unknown> } } {
  const calls: Recorded[] = [];
  return {
    calls,
    messages: {
      create: (body: unknown, options?: unknown): Promise<unknown> => {
        calls.push({ body: body as Record<string, unknown>, options });
        return Promise.resolve(handler());
      },
    },
  };
}

function throwingClient(error: unknown): { messages: { create: () => Promise<unknown> } } {
  return {
    messages: {
      create: (): Promise<unknown> => Promise.reject(error),
    },
  };
}

const toolUseResponse = (input: unknown): unknown => ({
  id: 'msg_test',
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id: 'toolu_test', name: refundOrderTool.name, input }],
});

const probe = anthropicProvider.probe?.bind(anthropicProvider);

let savedKey: string | undefined;
let savedModel: string | undefined;

beforeEach(() => {
  savedKey = process.env['ANTHROPIC_API_KEY'];
  savedModel = process.env[PROBE_MODEL_ENV_VAR];
  delete process.env['ANTHROPIC_API_KEY'];
  delete process.env[PROBE_MODEL_ENV_VAR];
});

afterEach(() => {
  if (savedKey === undefined) delete process.env['ANTHROPIC_API_KEY'];
  else process.env['ANTHROPIC_API_KEY'] = savedKey;
  if (savedModel === undefined) delete process.env[PROBE_MODEL_ENV_VAR];
  else process.env[PROBE_MODEL_ENV_VAR] = savedModel;
  vi.restoreAllMocks();
});

describe('probe request', () => {
  it('sends the compiled tool, a small max_tokens and a forced tool choice', async () => {
    const client = stubClient(() => toolUseResponse({ orderId: 'ord_1', amount: 10 }));
    await probe?.(refundOrderTool, { client });

    expect(client.calls).toHaveLength(1);
    const body = client.calls[0]?.body ?? {};
    expect(body['model']).toBe(DEFAULT_PROBE_MODEL);
    expect(body['max_tokens']).toBe(1024);
    expect(body['tool_choice']).toEqual({ type: 'tool', name: 'refund_order' });
    expect(body['tools']).toEqual([anthropicProvider.compile(refundOrderTool).output]);

    const messages = body['messages'] as { role: string; content: string }[];
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('user');
    expect(messages[0]?.content).toContain('refund_order');
  });

  it('prefers options.model over the environment variable', async () => {
    process.env[PROBE_MODEL_ENV_VAR] = 'claude-from-env';
    const client = stubClient(() => toolUseResponse({ orderId: 'ord_1' }));
    const result = await probe?.(refundOrderTool, { client, model: 'claude-explicit' });
    expect(result?.model).toBe('claude-explicit');
    expect(client.calls[0]?.body['model']).toBe('claude-explicit');
  });

  it('falls back to SCHEMAPORT_ANTHROPIC_MODEL', async () => {
    process.env[PROBE_MODEL_ENV_VAR] = 'claude-from-env';
    const client = stubClient(() => toolUseResponse({ orderId: 'ord_1' }));
    const result = await probe?.(refundOrderTool, { client });
    expect(result?.model).toBe('claude-from-env');
  });

  it('passes a timeout through to the SDK request options', async () => {
    const client = stubClient(() => toolUseResponse({ orderId: 'ord_1' }));
    await probe?.(refundOrderTool, { client, timeoutMs: 5000 });
    expect(client.calls[0]?.options).toEqual({ timeout: 5000 });
  });
});

describe('accepted', () => {
  it('reports acceptance and validates arguments against the canonical schema', async () => {
    const client = stubClient(() => toolUseResponse({ orderId: 'ord_1', amount: 12.5 }));
    const result = await probe?.(refundOrderTool, { client });

    expect(result?.status).toBe('accepted');
    expect(result?.schemaAccepted).toBe(true);
    expect(result?.toolCallReturned).toBe(true);
    expect(result?.argumentsValid).toBe(true);
    expect(result?.argumentsReceived).toEqual({ orderId: 'ord_1', amount: 12.5 });
  });

  it('surfaces arguments that violate the canonical schema', async () => {
    const client = stubClient(() => toolUseResponse({ orderId: 'ord_1', amount: -5 }));
    const result = await probe?.(refundOrderTool, { client });

    expect(result?.status).toBe('accepted');
    expect(result?.argumentsValid).toBe(false);
    expect(result?.argumentErrors?.length).toBeGreaterThan(0);
  });

  it('does not inspect a response truncated at max_tokens', async () => {
    const client = stubClient(() => ({
      stop_reason: 'max_tokens',
      content: [{ type: 'tool_use', name: refundOrderTool.name, input: { orderId: 'ord' } }],
    }));
    const result = await probe?.(refundOrderTool, { client });

    expect(result?.status).toBe('accepted');
    expect(result?.toolCallReturned).toBe(false);
    expect(result?.argumentsValid).toBeUndefined();
    expect(result?.notes.join(' ')).toContain('max_tokens');
  });

  it('treats a model refusal as an accepted schema with no tool call', async () => {
    const client = stubClient(() => ({ stop_reason: 'refusal', content: [] }));
    const result = await probe?.(refundOrderTool, { client });

    expect(result?.status).toBe('accepted');
    expect(result?.schemaAccepted).toBe(true);
    expect(result?.toolCallReturned).toBe(false);
  });

  it('handles a response with no tool_use block', async () => {
    const client = stubClient(() => ({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'I would rather not.' }],
    }));
    const result = await probe?.(refundOrderTool, { client });

    expect(result?.status).toBe('accepted');
    expect(result?.toolCallReturned).toBe(false);
  });
});

describe('rejected', () => {
  it('classifies a 400 invalid_request_error as a schema rejection', async () => {
    const client = throwingClient({
      status: 400,
      error: {
        type: 'invalid_request_error',
        message: 'tools.0.input_schema: Input tag is not valid JSON Schema.',
      },
    });
    const result = await probe?.(refundOrderTool, { client });

    expect(result?.status).toBe('rejected');
    expect(result?.schemaAccepted).toBe(false);
    expect(result?.providerError?.status).toBe(400);
    expect(result?.providerError?.message).toContain('input_schema');
  });
});

describe('environment errors are never reported as schema rejections', () => {
  it('reports a missing API key without sending a request', async () => {
    const result = await probe?.(refundOrderTool);

    expect(result?.status).toBe('error');
    expect(result?.errorKind).toBe('missing-credentials');
    expect(result?.schemaAccepted).toBe(false);
    expect(result?.notes.join(' ')).toContain('ANTHROPIC_API_KEY');
  });

  it('classifies a 404 as model-not-found, not rejected', async () => {
    const client = throwingClient({
      status: 404,
      error: { type: 'not_found_error', message: 'model: claude-nope-1' },
    });
    const result = await probe?.(refundOrderTool, { client, model: 'claude-nope-1' });

    expect(result?.status).toBe('error');
    expect(result?.errorKind).toBe('model-not-found');
    expect(result?.model).toBe('claude-nope-1');
    expect(result?.notes.join(' ')).toContain('not a schema problem');
  });

  it('classifies a 401 as authentication', async () => {
    const client = throwingClient({
      status: 401,
      error: { type: 'authentication_error', message: 'invalid x-api-key' },
    });
    const result = await probe?.(refundOrderTool, { client });

    expect(result?.status).toBe('error');
    expect(result?.errorKind).toBe('authentication');
  });

  it('classifies a connection failure as network', async () => {
    const client = throwingClient(Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' }));
    const result = await probe?.(refundOrderTool, { client });

    expect(result?.status).toBe('error');
    expect(result?.errorKind).toBe('network');
  });
});

describe('compile gate', () => {
  it('never sends a request when compilation is refused', async () => {
    const client = stubClient(() => toolUseResponse({}));
    const result = await probe?.(dottedNameTool, { client });

    expect(result?.status).toBe('error');
    expect(result?.errorKind).toBe('compile-refused');
    expect(client.calls).toHaveLength(0);
  });
});

describe('strict probes', () => {
  it('sends the default, non-strict definition unless asked', async () => {
    const client = stubClient(() => toolUseResponse({ orderId: 'ord_1' }));
    await probe?.(refundOrderTool, { client });

    const tools = client.calls[0]?.body['tools'] as { strict?: unknown }[];
    expect(tools[0]?.strict).toBeUndefined();
  });

  it('sends the strict definition when asked, with allowLossy', async () => {
    const client = stubClient(() => toolUseResponse({ orderId: 'ord_1', amount: 5 }));
    const result = await probe?.(refundOrderTool, { client, strict: true, allowLossy: true });

    expect(result?.status).toBe('accepted');
    expect(client.calls[0]?.body['tools']).toEqual([
      anthropicProvider.compile(refundOrderTool, { strict: true, allowLossy: true }).output,
    ]);
    const tools = client.calls[0]?.body['tools'] as { strict?: unknown }[];
    expect(tools[0]?.strict).toBe(true);
  });

  it('refuses to send a strict schema whose losses the caller has not accepted', async () => {
    const client = stubClient(() => toolUseResponse({ orderId: 'ord_1' }));
    const result = await probe?.(refundOrderTool, { client, strict: true });

    expect(result?.status).toBe('error');
    expect(result?.errorKind).toBe('compile-refused');
    expect(client.calls).toHaveLength(0);
  });

  it('probes a strict schema that needs no allowLossy', async () => {
    const client = stubClient(() => ({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', name: 'ping', input: {} }],
    }));
    const result = await probe?.(minimalTool, { client, strict: true });

    expect(result?.status).toBe('accepted');
    expect(client.calls).toHaveLength(1);
  });

  it('reports a 400 on the strict definition as a schema rejection', async () => {
    const client = throwingClient({
      status: 400,
      error: {
        type: 'invalid_request_error',
        message: 'tools.0.input_schema: strict mode does not support `pattern`.',
      },
    });
    const result = await probe?.(refundOrderTool, { client, strict: true, allowLossy: true });

    expect(result?.status).toBe('rejected');
    expect(result?.schemaAccepted).toBe(false);
    expect(result?.providerError?.status).toBe(400);
  });

  it('still classifies environment failures as environment failures under strict', async () => {
    const client = throwingClient({
      status: 404,
      error: { type: 'not_found_error', message: 'model: claude-nope-1' },
    });
    const result = await probe?.(refundOrderTool, {
      client,
      strict: true,
      allowLossy: true,
      model: 'claude-nope-1',
    });

    expect(result?.status).toBe('error');
    expect(result?.errorKind).toBe('model-not-found');
  });

  it('validates arguments against the canonical schema, not the reduced strict one', async () => {
    // `minimum: 0` cannot survive strict compilation, so Anthropic cannot
    // enforce it — but core still checks the returned value against the
    // canonical schema, which is exactly how the cost of strict mode shows up.
    const client = stubClient(() => toolUseResponse({ orderId: 'ord_1', amount: -5 }));
    const result = await probe?.(refundOrderTool, { client, strict: true, allowLossy: true });

    expect(result?.status).toBe('accepted');
    expect(result?.argumentsValid).toBe(false);
    expect(result?.argumentErrors?.length).toBeGreaterThan(0);
  });

  it('never reads the environment when a client seam is supplied', async () => {
    const client = stubClient(() => toolUseResponse({ orderId: 'ord_1' }));
    const result = await probe?.(refundOrderTool, { client, strict: true, allowLossy: true });
    expect(result?.status).toBe('accepted');
    expect(process.env['ANTHROPIC_API_KEY']).toBeUndefined();
  });
});
