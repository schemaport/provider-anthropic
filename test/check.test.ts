import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '@schemaport/core';
import {
  constraintTool,
  minimalTool,
  nestedTool,
  openMapTool,
  refundOrderTool,
  unionTool,
} from '@schemaport/core';

import { CODES, anthropicProvider } from '../src/index.js';
import {
  dottedNameTool,
  exoticValuesTool,
  externalRefTool,
  longNameTool,
  stringRootTool,
  undocumentedKeywordTool,
  untypedRootTool,
} from './fixtures.js';

const check = (tool: Parameters<typeof anthropicProvider.check>[0]): Diagnostic[] =>
  anthropicProvider.check(tool);

const codes = (diagnostics: readonly Diagnostic[]): string[] => diagnostics.map((d) => d.code);

const find = (diagnostics: readonly Diagnostic[], code: string): Diagnostic | undefined =>
  diagnostics.find((d) => d.code === code);

describe('provider metadata', () => {
  it('exposes the contract fields the CLI reads', () => {
    expect(anthropicProvider.id).toBe('anthropic');
    expect(anthropicProvider.displayName).toBe('Anthropic');
    expect(anthropicProvider.rulesReviewedAt).toBe('2026-08-20');
    expect(anthropicProvider.apiKeyEnvVar).toBe('ANTHROPIC_API_KEY');
    expect(anthropicProvider.docs.length).toBeGreaterThan(0);
    for (const doc of anthropicProvider.docs) {
      expect(doc.url.startsWith('https://')).toBe(true);
    }
  });

  it('gives every diagnostic a namespaced code and a documentation link', () => {
    const diagnostics = [
      ...check(constraintTool),
      ...check(minimalTool),
      ...check(dottedNameTool),
      ...check(stringRootTool),
      ...check(untypedRootTool),
      ...check(undocumentedKeywordTool),
      ...check(exoticValuesTool),
      ...check(externalRefTool),
    ];
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const item of diagnostics) {
      expect(item.providerId).toBe('anthropic');
      expect(item.code.startsWith('anthropic/')).toBe(true);
      expect(item.docsUrl).toBeDefined();
      expect(item.path.length).toBeGreaterThan(0);
    }
  });
});

describe('anthropic/invalid-tool-name', () => {
  it('rejects a name outside ^[a-zA-Z0-9_-]{1,64}$', () => {
    const diagnostic = find(check(dottedNameTool), CODES.invalidToolName);
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.severity).toBe('error');
    expect(diagnostic?.path).toBe('name');
    expect(diagnostic?.compile.supported).toBe(false);
  });

  it('rejects a name longer than 64 characters', () => {
    const diagnostic = find(check(longNameTool), CODES.invalidToolName);
    expect(diagnostic?.severity).toBe('error');
    expect(diagnostic?.message).toContain('65 characters');
  });

  it('accepts the shared fixture names', () => {
    for (const tool of [refundOrderTool, minimalTool, nestedTool, openMapTool, unionTool]) {
      expect(codes(check(tool))).not.toContain(CODES.invalidToolName);
    }
  });
});

describe('anthropic/input-schema-not-object', () => {
  it('refuses a root schema that is not an object', () => {
    const diagnostic = find(check(stringRootTool), CODES.inputSchemaNotObject);
    expect(diagnostic?.severity).toBe('error');
    expect(diagnostic?.path).toBe('inputSchema.type');
    expect(diagnostic?.compile.supported).toBe(false);
  });
});

describe('anthropic/missing-input-schema-type', () => {
  it('reports a root schema with no type and lets compile fix it', () => {
    const diagnostic = find(check(untypedRootTool), CODES.missingInputSchemaType);
    expect(diagnostic?.severity).toBe('error');
    expect(diagnostic?.compile.supported).toBe(true);
    expect(diagnostic?.compile.lossy).toBe(false);
  });
});

describe('anthropic/schema-not-enforced', () => {
  it('warns that Anthropic does not validate tool inputs by default', () => {
    const diagnostic = find(check(refundOrderTool), CODES.schemaNotEnforced);
    expect(diagnostic?.severity).toBe('warning');
    expect(diagnostic?.path).toBe('inputSchema');
    expect(diagnostic?.compile.lossy).toBe(false);
  });

  it('stays quiet for a tool that constrains nothing', () => {
    expect(codes(check(minimalTool))).not.toContain(CODES.schemaNotEnforced);
  });
});

describe('anthropic/constraint-not-enforced', () => {
  it('flags every documented-unsupported constraint in the constraint fixture', () => {
    const paths = check(constraintTool)
      .filter((d) => d.code === CODES.constraintNotEnforced)
      .map((d) => d.path);

    expect(paths).toEqual([
      'inputSchema.properties.jobId.minLength',
      'inputSchema.properties.runEvery.maximum',
      'inputSchema.properties.runEvery.minimum',
      'inputSchema.properties.runEvery.multipleOf',
      'inputSchema.properties.window.maxItems',
      'inputSchema.properties.window.minItems',
    ]);
  });

  it('flags minimum inside a nested anyOf branch', () => {
    const paths = check(unionTool)
      .filter((d) => d.code === CODES.constraintNotEnforced)
      .map((d) => d.path);
    expect(paths).toEqual(['inputSchema.properties.limit.anyOf[0].minimum']);
  });

  it('flags a typed additionalProperties map', () => {
    const diagnostic = find(check(openMapTool), CODES.constraintNotEnforced);
    expect(diagnostic?.path).toBe('inputSchema.properties.tags.additionalProperties');
    expect(diagnostic?.severity).toBe('warning');
  });

  it('does not flag minItems values Anthropic documents as supported', () => {
    const paths = check({
      name: 'min_items_ok',
      description: 'minItems 0 and 1 are inside the documented strict subset.',
      inputSchema: {
        type: 'object',
        properties: {
          a: { type: 'array', items: { type: 'string' }, minItems: 0 },
          b: { type: 'array', items: { type: 'string' }, minItems: 1 },
        },
        required: ['a'],
      },
    })
      .filter((d) => d.code === CODES.constraintNotEnforced)
      .map((d) => d.path);
    expect(paths).toEqual([]);
  });

  it('does not flag additionalProperties: false', () => {
    const paths = check({
      name: 'closed_object',
      description: 'A closed object, which is what strict mode requires.',
      inputSchema: {
        type: 'object',
        properties: { a: { type: 'string' } },
        required: ['a'],
        additionalProperties: false,
      },
    })
      .filter((d) => d.code === CODES.constraintNotEnforced)
      .map((d) => d.path);
    expect(paths).toEqual([]);
  });
});

describe('anthropic/keyword-not-documented', () => {
  it('flags keywords absent from both documented lists', () => {
    const paths = check(undocumentedKeywordTool)
      .filter((d) => d.code === CODES.keywordNotDocumented)
      .map((d) => d.path);

    expect(paths).toEqual([
      'inputSchema.properties.anything.not',
      'inputSchema.properties.bounded.maxProperties',
      'inputSchema.properties.bounded.minProperties',
      'inputSchema.properties.choice.oneOf',
      'inputSchema.properties.pair.prefixItems',
    ]);
  });

  it('flags pattern, whose strict-mode support is undocumented', () => {
    const diagnostic = check(constraintTool).find(
      (d) => d.code === CODES.keywordNotDocumented && d.path.endsWith('.pattern'),
    );
    expect(diagnostic?.severity).toBe('warning');
    expect(diagnostic?.path).toBe('inputSchema.properties.jobId.pattern');
  });

  it('does not flag anyOf, which Anthropic documents as supported', () => {
    expect(codes(check(unionTool))).not.toContain(CODES.keywordNotDocumented);
  });
});

describe('anthropic/enum-non-primitive-value', () => {
  it('flags an enum member that is not a string, number, boolean or null', () => {
    const diagnostic = find(check(exoticValuesTool), CODES.enumNonPrimitiveValue);
    expect(diagnostic?.severity).toBe('warning');
    expect(diagnostic?.path).toBe('inputSchema.properties.mode.enum');
  });

  it('leaves a plain string enum alone', () => {
    expect(codes(check(nestedTool))).not.toContain(CODES.enumNonPrimitiveValue);
  });
});

describe('anthropic/undocumented-string-format', () => {
  it('flags a format outside the documented set', () => {
    const diagnostics = check(exoticValuesTool).filter(
      (d) => d.code === CODES.undocumentedStringFormat,
    );
    expect(diagnostics.map((d) => d.path)).toEqual(['inputSchema.properties.website.format']);
  });

  it('accepts email, which Anthropic documents', () => {
    expect(codes(check(nestedTool))).not.toContain(CODES.undocumentedStringFormat);
  });
});

describe('anthropic/external-ref', () => {
  it('flags a $ref outside the document but not a local one', () => {
    const diagnostics = check(externalRefTool).filter((d) => d.code === CODES.externalRef);
    expect(diagnostics.map((d) => d.path)).toEqual(['inputSchema.properties.remote.$ref']);
  });
});

describe('anthropic/missing-tool-description', () => {
  it('reports a missing description as info', () => {
    const diagnostic = find(check(minimalTool), CODES.missingToolDescription);
    expect(diagnostic?.severity).toBe('info');
    expect(diagnostic?.path).toBe('description');
  });

  it('stays quiet when a description is present', () => {
    expect(codes(check(refundOrderTool))).not.toContain(CODES.missingToolDescription);
  });
});

describe('determinism', () => {
  it('returns the same diagnostics in the same order on repeat calls', () => {
    for (const tool of [refundOrderTool, nestedTool, constraintTool, undocumentedKeywordTool]) {
      expect(JSON.stringify(check(tool))).toBe(JSON.stringify(check(tool)));
    }
  });
});
