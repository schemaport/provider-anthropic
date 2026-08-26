import { describe, expect, it } from 'vitest';
import type {
  CanonicalTool,
  Diagnostic,
  SchemaPortProvider,
  Transformation,
} from '@schemaport/core';
import {
  constraintTool,
  FIXTURE_TOOLS,
  isLossy,
  minimalTool,
  nestedTool,
  openMapTool,
  refundOrderTool,
  unionTool,
} from '@schemaport/core';

import {
  CODES,
  STRICT_ONLY_CODES,
  TRANSFORMATIONS,
  anthropicProvider,
} from '../src/index.js';
import {
  closedTool,
  dottedNameTool,
  exoticValuesTool,
  externalRefTool,
  localRefTool,
  openObjectTool,
  undocumentedKeywordTool,
  untypedRootTool,
} from './fixtures.js';

/**
 * Strict mode is a different target from the default one, so these tests read
 * the whole trade: what strict buys (enforcement, `strict: true` on the wire)
 * and what it costs (every keyword the documented subset rejects).
 */

const strict = (tool: CanonicalTool): ReturnType<typeof anthropicProvider.compile> =>
  anthropicProvider.compile(tool, { strict: true });

const strictLossy = (tool: CanonicalTool): ReturnType<typeof anthropicProvider.compile> =>
  anthropicProvider.compile(tool, { strict: true, allowLossy: true });

const codes = (items: readonly Diagnostic[]): string[] => items.map((d) => d.code);
const transformationCodes = (items: readonly Transformation[]): string[] =>
  items.map((t) => t.code);

const pathsFor = (items: readonly Transformation[], code: string): string[] =>
  items.filter((t) => t.code === code).map((t) => t.path);

const inputSchema = (result: ReturnType<typeof anthropicProvider.compile>): Record<string, unknown> =>
  (result.output as { input_schema: Record<string, unknown> }).input_schema;

describe('the public API', () => {
  it('still satisfies the shared provider contract the CLI consumes', () => {
    // Type-level: `AnthropicProvider` only widens the contract with optional
    // options, so this assignment must keep compiling. `npm run lint` typechecks
    // this file, so a breaking widening fails the build rather than the run.
    const contract: SchemaPortProvider = anthropicProvider;
    expect(contract.id).toBe('anthropic');
    expect(typeof contract.compile).toBe('function');
    expect(typeof contract.probe).toBe('function');
  });
});

describe('opting in', () => {
  it('emits `strict: true` on the tool definition', () => {
    const result = strictLossy(refundOrderTool);
    expect(result.ok).toBe(true);
    expect((result.output as { strict?: unknown }).strict).toBe(true);
  });

  it('does not emit `strict` at all by default', () => {
    const result = anthropicProvider.compile(refundOrderTool);
    expect(Object.keys(result.output as object)).toEqual(['name', 'description', 'input_schema']);
  });

  it('records enabling strict mode as a non-lossy transformation', () => {
    const enabled = strictLossy(refundOrderTool).transformations.find(
      (t) => t.code === TRANSFORMATIONS.enabledStrictMode,
    );
    expect(enabled?.lossy).toBe(false);
    expect(enabled?.path).toBe('inputSchema');
  });
});

describe('the refuse / allow-lossy demonstration', () => {
  it('refuses the PRD example, because `minimum: 0` cannot survive', () => {
    const result = strict(refundOrderTool);

    expect(result.ok).toBe(false);
    expect(result.output).toBeUndefined();
    expect(codes(result.diagnostics)).toContain('core/lossy-transformation-refused');

    const refusal = result.diagnostics.find((d) => d.code === 'core/lossy-transformation-refused');
    expect(refusal?.message).toContain('inputSchema.properties.amount.minimum');
  });

  it('succeeds with allowLossy and records the loss', () => {
    const result = strictLossy(refundOrderTool);

    expect(result.ok).toBe(true);
    expect(isLossy(result)).toBe(true);
    expect(inputSchema(result)).toEqual({
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'The order to refund' },
        amount: { type: 'number', description: 'Amount to refund. Omit to refund the full order.' },
      },
      required: ['orderId', 'amount'],
      additionalProperties: false,
    });

    const dropped = result.transformations.find(
      (t) => t.code === TRANSFORMATIONS.droppedNumericConstraint,
    );
    expect(dropped?.lossy).toBe(true);
    expect(dropped?.path).toBe('inputSchema.properties.amount.minimum');
    expect(dropped?.detail).toContain('minimum');
  });

  it('compiles clean without allowLossy when the schema carries no rejected keyword', () => {
    const result = strict(minimalTool);
    expect(result.ok).toBe(true);
    expect(isLossy(result)).toBe(false);
    expect(inputSchema(result)).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
  });
});

describe('rejected keyword classes', () => {
  const numericTool: CanonicalTool = {
    name: 'numeric_constraints',
    description: 'Every numerical constraint the strict subset rejects.',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'number', minimum: 1, maximum: 9 },
        b: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 10, multipleOf: 2 },
      },
      required: ['a', 'b'],
    },
  };

  const stringTool: CanonicalTool = {
    name: 'string_constraints',
    description: 'Every string constraint the strict subset rejects.',
    inputSchema: {
      type: 'object',
      properties: { s: { type: 'string', minLength: 1, maxLength: 8 } },
      required: ['s'],
    },
  };

  const arrayTool: CanonicalTool = {
    name: 'array_constraints',
    description: 'Array constraints beyond the documented minItems cases.',
    inputSchema: {
      type: 'object',
      properties: {
        many: { type: 'array', items: { type: 'string' }, maxItems: 4, uniqueItems: true },
        two: { type: 'array', items: { type: 'string' }, minItems: 2 },
        one: { type: 'array', items: { type: 'string' }, minItems: 1 },
        none: { type: 'array', items: { type: 'string' }, minItems: 0 },
      },
      required: ['many', 'two', 'one', 'none'],
    },
  };

  it('drops numerical constraints and reports them', () => {
    expect(pathsFor(strictLossy(numericTool).transformations, TRANSFORMATIONS.droppedNumericConstraint)).toEqual([
      'inputSchema.properties.a.minimum',
      'inputSchema.properties.a.maximum',
      'inputSchema.properties.b.exclusiveMinimum',
      'inputSchema.properties.b.exclusiveMaximum',
      'inputSchema.properties.b.multipleOf',
    ]);

    const diagnostics = anthropicProvider
      .check(numericTool, { strict: true })
      .filter((d) => d.code === CODES.strictDropsNumericConstraint);
    expect(diagnostics.map((d) => d.path)).toEqual([
      'inputSchema.properties.a.maximum',
      'inputSchema.properties.a.minimum',
      'inputSchema.properties.b.exclusiveMaximum',
      'inputSchema.properties.b.exclusiveMinimum',
      'inputSchema.properties.b.multipleOf',
    ]);
    for (const item of diagnostics) {
      expect(item.severity).toBe('error');
      expect(item.compile.supported).toBe(true);
      expect(item.compile.lossy).toBe(true);
    }

    expect(inputSchema(strictLossy(numericTool))['properties']).toEqual({
      a: { type: 'number' },
      b: { type: 'number' },
    });
  });

  it('drops string constraints and reports them', () => {
    expect(pathsFor(strictLossy(stringTool).transformations, TRANSFORMATIONS.droppedStringConstraint)).toEqual([
      'inputSchema.properties.s.minLength',
      'inputSchema.properties.s.maxLength',
    ]);
    expect(
      anthropicProvider
        .check(stringTool, { strict: true })
        .filter((d) => d.code === CODES.strictDropsStringConstraint)
        .map((d) => d.path),
    ).toEqual(['inputSchema.properties.s.maxLength', 'inputSchema.properties.s.minLength']);
  });

  it('drops array constraints, but keeps `minItems` of 0 and 1', () => {
    const result = strictLossy(arrayTool);
    expect(pathsFor(result.transformations, TRANSFORMATIONS.droppedArrayConstraint)).toEqual([
      'inputSchema.properties.many.maxItems',
      'inputSchema.properties.many.uniqueItems',
      'inputSchema.properties.two.minItems',
    ]);

    expect(inputSchema(result)['properties']).toEqual({
      many: { type: 'array', items: { type: 'string' } },
      two: { type: 'array', items: { type: 'string' } },
      one: { type: 'array', items: { type: 'string' }, minItems: 1 },
      none: { type: 'array', items: { type: 'string' }, minItems: 0 },
    });

    expect(
      anthropicProvider
        .check(arrayTool, { strict: true })
        .filter((d) => d.code === CODES.strictDropsArrayConstraint)
        .map((d) => d.path),
    ).toEqual([
      'inputSchema.properties.many.maxItems',
      'inputSchema.properties.many.uniqueItems',
      'inputSchema.properties.two.minItems',
    ]);
  });

  it('drops rejected keywords inside nested branches, not just at the top level', () => {
    expect(pathsFor(strictLossy(unionTool).transformations, TRANSFORMATIONS.droppedNumericConstraint)).toEqual([
      'inputSchema.properties.limit.anyOf[0].minimum',
    ]);
    expect(pathsFor(strictLossy(nestedTool).transformations, TRANSFORMATIONS.droppedArrayConstraint)).toEqual([
      'inputSchema.properties.labels.maxItems',
    ]);
  });
});

describe('additionalProperties', () => {
  it('drops a typed map and calls it lossy', () => {
    expect(strict(openMapTool).ok).toBe(false);

    const result = strictLossy(openMapTool);
    const dropped = result.transformations.find(
      (t) => t.code === TRANSFORMATIONS.droppedAdditionalPropertiesSchema,
    );
    expect(dropped?.lossy).toBe(true);
    expect(dropped?.path).toBe('inputSchema.properties.tags.additionalProperties');
    expect((inputSchema(result)['properties'] as Record<string, unknown>)['tags']).toEqual({
      type: 'object',
      additionalProperties: false,
    });

    const diagnostic = anthropicProvider
      .check(openMapTool, { strict: true })
      .find((d) => d.code === CODES.strictDropsAdditionalProperties);
    expect(diagnostic?.severity).toBe('error');
    expect(diagnostic?.compile.lossy).toBe(true);
  });

  it('closes an explicitly open object without calling it lossy, but warns', () => {
    const result = strict(openObjectTool);
    expect(result.ok).toBe(true);
    expect(isLossy(result)).toBe(false);
    expect(
      result.transformations.find((t) => t.code === TRANSFORMATIONS.closedOpenObject)?.lossy,
    ).toBe(false);
    expect(codes(result.diagnostics)).toContain(CODES.strictClosedOpenObject);

    const diagnostics = anthropicProvider.check(openObjectTool, { strict: true });
    expect(codes(diagnostics)).toContain(CODES.strictDropsAdditionalProperties);
  });

  it('adds `additionalProperties: false` to every object that did not declare it', () => {
    const result = strictLossy(nestedTool);
    expect(pathsFor(result.transformations, TRANSFORMATIONS.addedAdditionalPropertiesFalse)).toEqual([
      'inputSchema.properties.requester.additionalProperties',
      'inputSchema.properties.history.items.additionalProperties',
      'inputSchema.additionalProperties',
    ]);
    for (const transformationRecord of result.transformations.filter(
      (t) => t.code === TRANSFORMATIONS.addedAdditionalPropertiesFalse,
    )) {
      expect(transformationRecord.lossy).toBe(false);
    }
  });

  it('records nothing when the object was already closed', () => {
    const result = strict(closedTool);
    expect(result.ok).toBe(true);
    expect(transformationCodes(result.transformations)).toEqual([
      TRANSFORMATIONS.renamedInputSchemaField,
      TRANSFORMATIONS.enabledStrictMode,
    ]);
    expect(inputSchema(result)['additionalProperties']).toBe(false);
  });
});

describe('required', () => {
  it('lists every declared property in required and warns that the model must send it', () => {
    const result = strictLossy(refundOrderTool);
    const required = result.transformations.find(
      (t) => t.code === TRANSFORMATIONS.requiredEveryProperty,
    );
    expect(required?.lossy).toBe(false);
    expect(required?.path).toBe('inputSchema.required');
    expect(required?.detail).toContain('`amount`');
    expect(inputSchema(result)['required']).toEqual(['orderId', 'amount']);

    expect(
      result.diagnostics.find((d) => d.code === CODES.strictAlwaysPresentProperty)?.path,
    ).toBe('inputSchema.properties.amount');
  });

  it('reports the canonical schema as unsendable and lets compile fix it', () => {
    const diagnostic = anthropicProvider
      .check(refundOrderTool, { strict: true })
      .find((d) => d.code === CODES.strictOptionalProperty);
    expect(diagnostic?.severity).toBe('error');
    expect(diagnostic?.compile.supported).toBe(true);
    expect(diagnostic?.compile.lossy).toBe(false);
    expect(diagnostic?.path).toBe('inputSchema.properties.amount');
  });

  it('closes nested objects too', () => {
    expect(pathsFor(strictLossy(nestedTool).transformations, TRANSFORMATIONS.requiredEveryProperty)).toEqual([
      'inputSchema.properties.requester.required',
      'inputSchema.properties.history.items.required',
      'inputSchema.required',
    ]);
  });

  it('records nothing when every property was already required', () => {
    expect(
      transformationCodes(strictLossy(openMapTool).transformations),
    ).not.toContain(TRANSFORMATIONS.requiredEveryProperty);
  });
});

describe('keywords the documentation does not classify', () => {
  it('keeps them and says so, rather than dropping them on a guess', () => {
    const result = strict(undocumentedKeywordTool);
    expect(result.ok).toBe(true);

    const kept = result.diagnostics.filter((d) => d.code === CODES.strictKeywordUndocumented);
    expect(kept.map((d) => d.path)).toEqual([
      'inputSchema.properties.anything.not',
      'inputSchema.properties.bounded.maxProperties',
      'inputSchema.properties.bounded.minProperties',
      'inputSchema.properties.choice.oneOf',
      'inputSchema.properties.pair.prefixItems',
    ]);
    for (const item of kept) {
      expect(item.severity).toBe('warning');
      expect(item.message).toContain('may be rejected');
    }

    const properties = inputSchema(result)['properties'] as Record<string, Record<string, unknown>>;
    expect(properties['choice']?.['oneOf']).toBeDefined();
    expect(properties['pair']?.['prefixItems']).toBeDefined();
    expect(properties['anything']?.['not']).toBeDefined();
    expect(properties['bounded']?.['minProperties']).toBe(1);
  });

  it('keeps `pattern`, whose strict-mode status the documentation only implies', () => {
    const result = strictLossy(constraintTool);
    const properties = inputSchema(result)['properties'] as Record<string, Record<string, unknown>>;
    expect(properties['jobId']?.['pattern']).toBe('^job_[a-z0-9]+$');
    expect(codes(result.diagnostics)).toContain(CODES.strictKeywordUndocumented);
  });

  it('still drops rejected keywords inside a kept `oneOf` branch', () => {
    const tool: CanonicalTool = {
      name: 'branchy',
      description: 'A rejected keyword hiding inside an undocumented composition keyword.',
      inputSchema: {
        type: 'object',
        properties: { pick: { oneOf: [{ type: 'string', maxLength: 3 }, { type: 'number' }] } },
        required: ['pick'],
      },
    };
    expect(pathsFor(strictLossy(tool).transformations, TRANSFORMATIONS.droppedStringConstraint)).toEqual([
      'inputSchema.properties.pick.oneOf[0].maxLength',
    ]);
  });

  it('warns that a local `$ref` may be recursive, which strict mode does not support', () => {
    const diagnostic = anthropicProvider
      .check(localRefTool, { strict: true })
      .find((d) => d.code === CODES.strictLocalRef);
    expect(diagnostic?.severity).toBe('warning');
    expect(diagnostic?.message).toContain('cannot confirm');
    expect(codes(anthropicProvider.check(localRefTool))).not.toContain(CODES.strictLocalRef);
  });

  it('keeps an external `$ref` and adds the strict caveat to the existing warning', () => {
    const relaxed = anthropicProvider
      .check(externalRefTool)
      .find((d) => d.code === CODES.externalRef);
    const strictly = anthropicProvider
      .check(externalRefTool, { strict: true })
      .find((d) => d.code === CODES.externalRef);

    expect(relaxed?.message).not.toContain('400');
    expect(strictly?.message).toContain('400');
    const properties = inputSchema(strict(externalRefTool))['properties'] as Record<
      string,
      Record<string, unknown>
    >;
    expect(properties['remote']?.['$ref']).toBe('https://example.com/schemas/address.json');
  });

  it('adds the same caveat to enum and format warnings', () => {
    const strictly = anthropicProvider.check(exoticValuesTool, { strict: true });
    expect(strictly.find((d) => d.code === CODES.enumNonPrimitiveValue)?.message).toContain('400');
    expect(strictly.find((d) => d.code === CODES.undocumentedStringFormat)?.message).toContain('400');
  });
});

describe('rules that only make sense in one mode', () => {
  it('does not claim the schema is unenforced when strict mode enforces it', () => {
    expect(codes(anthropicProvider.check(refundOrderTool, { strict: true }))).not.toContain(
      CODES.schemaNotEnforced,
    );
    expect(codes(anthropicProvider.check(refundOrderTool))).toContain(CODES.schemaNotEnforced);
  });

  it('does not report a dropped keyword as "preserved but not enforced"', () => {
    expect(codes(anthropicProvider.check(constraintTool, { strict: true }))).not.toContain(
      CODES.constraintNotEnforced,
    );
    expect(codes(anthropicProvider.check(constraintTool))).toContain(CODES.constraintNotEnforced);
  });

  it('emits no strict-only code when strict is off, for any fixture', () => {
    const tools = [...Object.values(FIXTURE_TOOLS), untypedRootTool, openObjectTool, localRefTool];
    for (const tool of tools) {
      for (const code of codes(anthropicProvider.check(tool))) {
        expect(STRICT_ONLY_CODES, `${tool.name} emitted ${code}`).not.toContain(code);
      }
    }
  });

  it('every strict diagnostic is namespaced and documented', () => {
    const tools = [...Object.values(FIXTURE_TOOLS), openObjectTool, undocumentedKeywordTool];
    for (const tool of tools) {
      for (const item of anthropicProvider.check(tool, { strict: true })) {
        expect(item.code.startsWith('anthropic/')).toBe(true);
        expect(item.docsUrl).toBeDefined();
        expect(item.path.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('refusals strict mode does not change', () => {
  it('still refuses an illegal tool name, with or without allowLossy', () => {
    for (const options of [{ strict: true }, { strict: true, allowLossy: true }]) {
      const result = anthropicProvider.compile(dottedNameTool, options);
      expect(result.ok).toBe(false);
      expect(codes(result.diagnostics)).toContain(CODES.invalidToolName);
    }
  });

  it('still adds the missing root type before applying the strict rules', () => {
    const result = strict(untypedRootTool);
    expect(result.ok).toBe(true);
    expect(inputSchema(result)).toEqual({
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    });
  });
});

describe('every shared fixture, in both modes', () => {
  it('compiles by default and compiles strictly with allowLossy', () => {
    for (const [key, tool] of Object.entries(FIXTURE_TOOLS)) {
      expect(anthropicProvider.compile(tool).ok, `${key} default`).toBe(true);
      expect(strictLossy(tool).ok, `${key} strict+allowLossy`).toBe(true);
    }
  });

  it('refuses strictly without allowLossy exactly when a rejected keyword is present', () => {
    const refused: Record<string, boolean> = {};
    for (const [key, tool] of Object.entries(FIXTURE_TOOLS)) refused[key] = !strict(tool).ok;

    expect(refused).toEqual({
      refund_order: true, // minimum
      ping: false, // constrains nothing
      create_ticket: true, // minLength, maxLength, minimum, maximum, maxItems
      tag_resource: true, // typed additionalProperties
      set_limit: true, // minimum inside anyOf
      schedule_job: true, // minLength, minimum, maximum, multipleOf, minItems, maxItems
    });
  });

  it('never leaves a rejected keyword in strict output', () => {
    const rejected = [
      'minimum',
      'maximum',
      'exclusiveMinimum',
      'exclusiveMaximum',
      'multipleOf',
      'minLength',
      'maxLength',
      'maxItems',
      'uniqueItems',
    ];
    for (const [key, tool] of Object.entries(FIXTURE_TOOLS)) {
      const serialized = JSON.stringify(strictLossy(tool).output);
      for (const keyword of rejected) {
        expect(serialized.includes(`"${keyword}"`), `${key} still carries ${keyword}`).toBe(false);
      }
      expect(serialized).not.toMatch(/"minItems":\s*(?![01][,}])/);
      expect(serialized).not.toMatch(/"additionalProperties":\s*(?!false)/);
    }
  });

  it('closes every object in strict output', () => {
    for (const [key, tool] of Object.entries(FIXTURE_TOOLS)) {
      const schema = inputSchema(strictLossy(tool));
      expect(schema['additionalProperties'], `${key} root`).toBe(false);
      const properties = (schema['properties'] ?? {}) as Record<string, Record<string, unknown>>;
      for (const [name, sub] of Object.entries(properties)) {
        if (sub['type'] !== 'object' && sub['properties'] === undefined) continue;
        expect(sub['additionalProperties'], `${key}.${name}`).toBe(false);
      }
    }
  });
});

describe('determinism', () => {
  it('produces byte-identical strict results when compiled twice', () => {
    const tools = [
      ...Object.values(FIXTURE_TOOLS),
      untypedRootTool,
      openObjectTool,
      undocumentedKeywordTool,
      externalRefTool,
    ];
    for (const tool of tools) {
      for (const options of [{ strict: true }, { strict: true, allowLossy: true }]) {
        const first = anthropicProvider.compile(tool, options);
        const second = anthropicProvider.compile(tool, options);
        expect(JSON.stringify(second)).toBe(JSON.stringify(first));
      }
    }
  });

  it('does not mutate the canonical tool', () => {
    const before = JSON.stringify(FIXTURE_TOOLS);
    for (const tool of Object.values(FIXTURE_TOOLS)) strictLossy(tool);
    expect(JSON.stringify(FIXTURE_TOOLS)).toBe(before);
  });
});
