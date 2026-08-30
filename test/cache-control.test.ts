import { describe, expect, it } from 'vitest';
import type { CanonicalTool } from '@schemaport/core';

import { compileTool } from '../src/compile.js';
import type { AnthropicCacheControl, AnthropicToolDefinition } from '../src/compile.js';
import { CODES, MAX_CACHE_BREAKPOINTS } from '../src/rules.js';

const tool: CanonicalTool = {
  name: 'lookup_order',
  description: 'Look one order up by id',
  inputSchema: {
    type: 'object',
    properties: { orderId: { type: 'string' } },
    required: ['orderId'],
  },
};

type CacheOption = boolean | AnthropicCacheControl;

const compile = (cacheControl?: CacheOption) => compileTool(tool, { cacheControl });
const output = (cacheControl?: CacheOption) => compile(cacheControl).output as AnthropicToolDefinition;
const codes = (cacheControl?: CacheOption) => compile(cacheControl).diagnostics.map((d) => d.code);

describe('cacheControl option', () => {
  it('emits nothing when the option is absent', () => {
    expect(output()).not.toHaveProperty('cache_control');
    expect(codes()).not.toContain(CODES.cacheControlBreakpointScope);
  });

  it('emits nothing when the option is false', () => {
    expect(compile(false)).toEqual(compileTool(tool));
  });

  it('treats `true` as shorthand for an ephemeral breakpoint', () => {
    expect(output(true).cache_control).toEqual({ type: 'ephemeral' });
  });

  it('emits an explicit ttl', () => {
    expect(output({ type: 'ephemeral', ttl: '1h' }).cache_control).toEqual({
      type: 'ephemeral',
      ttl: '1h',
    });
    expect(output({ type: 'ephemeral', ttl: '5m' }).cache_control).toEqual({
      type: 'ephemeral',
      ttl: '5m',
    });
  });

  it('omits ttl entirely when it was not asked for, rather than defaulting it', () => {
    expect(Object.keys(output({ type: 'ephemeral' }).cache_control ?? {})).toEqual(['type']);
  });

  it('puts cache_control last, after strict', () => {
    const result = compileTool(tool, { cacheControl: true, strict: true, allowLossy: true });

    expect(Object.keys(result.output as AnthropicToolDefinition)).toEqual([
      'name',
      'description',
      'input_schema',
      'strict',
      'cache_control',
    ]);
  });

  it('serializes byte-identically across repeated compilations', () => {
    const a = JSON.stringify(output({ type: 'ephemeral', ttl: '1h' }));
    const b = JSON.stringify(output({ type: 'ephemeral', ttl: '1h' }));

    expect(a).toBe(b);
  });

  it('does not touch the schema', () => {
    expect(output(true).input_schema).toEqual(output().input_schema);
  });

  it('records one non-lossy transformation', () => {
    const added = compile(true).transformations.filter((t) => t.code === 'added-cache-control');

    expect(added).toHaveLength(1);
    expect(added[0]?.lossy).toBe(false);
    expect(added[0]?.path).toBe('cache_control');
  });

  it('names the ttl in the transformation detail when one was set', () => {
    const [added] = compile({ type: 'ephemeral', ttl: '1h' }).transformations.filter(
      (t) => t.code === 'added-cache-control',
    );

    expect(added?.detail).toContain('ttl: "1h"');
  });

  it('compiles without allowLossy, because caching destroys no constraint', () => {
    expect(compile(true).ok).toBe(true);
  });
});

describe('cacheControl diagnostics', () => {
  it('explains the breakpoint scope whenever one is requested', () => {
    const scope = compile(true).diagnostics.find(
      (d) => d.code === CODES.cacheControlBreakpointScope,
    );

    expect(scope?.severity).toBe('info');
    expect(scope?.message).toContain(String(MAX_CACHE_BREAKPOINTS));
    expect(scope?.message).toContain('before and including');
  });

  it('warns about an unrecognised ttl', () => {
    const bad = { type: 'ephemeral', ttl: '2h' } as unknown as AnthropicCacheControl;

    const warning = compile(bad).diagnostics.find((d) => d.code === CODES.cacheControlInvalidTtl);
    expect(warning?.severity).toBe('warning');
    expect(warning?.path).toBe('cacheControl.ttl');
  });

  it('drops an unrecognised ttl rather than forwarding a request the API rejects', () => {
    const bad = { type: 'ephemeral', ttl: '2h' } as unknown as AnthropicCacheControl;

    expect(output(bad).cache_control).toEqual({ type: 'ephemeral' });
  });

  it('does not warn about a valid ttl', () => {
    expect(codes({ type: 'ephemeral', ttl: '1h' })).not.toContain(CODES.cacheControlInvalidTtl);
  });

  it('emits no caching diagnostics at all when caching was not requested', () => {
    const emitted = codes();

    expect(emitted).not.toContain(CODES.cacheControlBreakpointScope);
    expect(emitted).not.toContain(CODES.cacheControlInvalidTtl);
  });

  it('is deterministic', () => {
    expect(compile(true).diagnostics).toEqual(compile(true).diagnostics);
  });
});
