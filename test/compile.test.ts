import { describe, expect, it } from 'vitest';
import { FIXTURE_TOOLS, isLossy, minimalTool, openMapTool, refundOrderTool } from '@schemaport/core';

import { CODES, TRANSFORMATIONS, anthropicProvider } from '../src/index.js';
import { dottedNameTool, stringRootTool, untypedRootTool } from './fixtures.js';

describe('compile', () => {
  it('compiles the PRD example without --allow-lossy', () => {
    const result = anthropicProvider.compile(refundOrderTool);

    expect(result.ok).toBe(true);
    expect(isLossy(result)).toBe(false);
    expect(result.output).toEqual({
      name: 'refund_order',
      description: 'Refunds all or part of an order',
      input_schema: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'The order to refund' },
          amount: {
            type: 'number',
            minimum: 0,
            description: 'Amount to refund. Omit to refund the full order.',
          },
        },
        required: ['orderId'],
      },
    });
  });

  it('compiles every shared fixture without --allow-lossy', () => {
    for (const tool of Object.values(FIXTURE_TOOLS)) {
      const result = anthropicProvider.compile(tool);
      expect(result.ok, `${tool.name} should compile`).toBe(true);
      expect(result.transformations.filter((t) => t.lossy)).toEqual([]);
    }
  });

  it('preserves every canonical keyword verbatim', () => {
    const result = anthropicProvider.compile(openMapTool);
    const output = result.output as { input_schema: Record<string, unknown> };
    expect(output.input_schema).toEqual(openMapTool.inputSchema);
  });

  it('does not mutate the canonical tool', () => {
    const before = JSON.stringify(refundOrderTool);
    anthropicProvider.compile(refundOrderTool);
    expect(JSON.stringify(refundOrderTool)).toBe(before);
  });

  it('omits description when the canonical tool has none', () => {
    const result = anthropicProvider.compile(minimalTool);
    expect(result.output).toEqual({
      name: 'ping',
      input_schema: { type: 'object', properties: {} },
    });
  });
});

describe('transformations', () => {
  it('records the inputSchema -> input_schema rename as non-lossy', () => {
    const result = anthropicProvider.compile(refundOrderTool);
    const rename = result.transformations.find(
      (t) => t.code === TRANSFORMATIONS.renamedInputSchemaField,
    );
    expect(rename).toBeDefined();
    expect(rename?.lossy).toBe(false);
    expect(rename?.path).toBe('inputSchema');
  });

  it('records adding the root object type as non-lossy', () => {
    const result = anthropicProvider.compile(untypedRootTool);
    expect(result.ok).toBe(true);
    expect(result.transformations.map((t) => t.code)).toEqual([
      TRANSFORMATIONS.renamedInputSchemaField,
      TRANSFORMATIONS.addedInputSchemaType,
    ]);
    expect(result.transformations.every((t) => !t.lossy)).toBe(true);
    const output = result.output as { input_schema: { type?: string } };
    expect(output.input_schema.type).toBe('object');
  });

  it('never emits a lossy transformation for any fixture', () => {
    const tools = [...Object.values(FIXTURE_TOOLS), untypedRootTool];
    for (const tool of tools) {
      expect(anthropicProvider.compile(tool).transformations.filter((t) => t.lossy)).toEqual([]);
    }
  });
});

describe('lossy gate', () => {
  it('produces identical output with and without allowLossy, because nothing is lossy', () => {
    for (const tool of Object.values(FIXTURE_TOOLS)) {
      const strictRun = anthropicProvider.compile(tool);
      const permissiveRun = anthropicProvider.compile(tool, { allowLossy: true });
      expect(JSON.stringify(permissiveRun)).toBe(JSON.stringify(strictRun));
    }
  });

  it('refuses a tool name the Messages API rejects, even with allowLossy', () => {
    for (const options of [undefined, { allowLossy: true }]) {
      const result = anthropicProvider.compile(dottedNameTool, options);
      expect(result.ok).toBe(false);
      expect(result.output).toBeUndefined();
      expect(result.diagnostics.map((d) => d.code)).toContain(CODES.invalidToolName);
    }
  });

  it('refuses a non-object root schema', () => {
    const result = anthropicProvider.compile(stringRootTool);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain(CODES.inputSchemaNotObject);
  });
});

describe('diagnostics carried into the compile result', () => {
  it('keeps warnings on a successful compile', () => {
    const result = anthropicProvider.compile(refundOrderTool);
    expect(result.ok).toBe(true);
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      CODES.schemaNotEnforced,
      CODES.constraintNotEnforced,
    ]);
  });

  it('drops the error compile worked around', () => {
    const result = anthropicProvider.compile(untypedRootTool);
    expect(result.ok).toBe(true);
    expect(result.diagnostics.map((d) => d.code)).not.toContain(CODES.missingInputSchemaType);
  });
});

describe('determinism', () => {
  it('produces byte-identical results when compiled twice', () => {
    for (const tool of [...Object.values(FIXTURE_TOOLS), untypedRootTool, dottedNameTool]) {
      const first = anthropicProvider.compile(tool);
      const second = anthropicProvider.compile(tool);
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    }
  });
});
