/**
 * Invariants over the keyword lists in `rules.ts`.
 *
 * `NEVER_ENFORCED_KEYWORDS` is derived from `STRICT_REJECTED_KEYWORDS`, so the
 * two cannot drift. These tests lock the properties that derivation is there to
 * guarantee, so that reverting it to a hand-written list fails loudly.
 */

import { describe, expect, it } from 'vitest';
import type { CanonicalTool, JsonSchema } from '@schemaport/core';

import { checkTool } from '../src/check.js';
import {
  NEVER_ENFORCED_KEYWORDS,
  STRICT_DROPPED_KEYWORDS,
  STRICT_REJECTED_KEYWORDS,
  UNDOCUMENTED_KEYWORDS,
  strictRejectedClass,
} from '../src/rules.js';

const tool = (inputSchema: JsonSchema): CanonicalTool => ({
  name: 'probe_keyword',
  description: 'Exercises one keyword',
  inputSchema,
});

describe('keyword list invariants', () => {
  it('every never-enforced keyword has a strict rejection class', () => {
    for (const keyword of NEVER_ENFORCED_KEYWORDS) {
      expect(strictRejectedClass(keyword), keyword).toBeDefined();
    }
  });

  it('the two lists are the same set, in the same order', () => {
    expect([...NEVER_ENFORCED_KEYWORDS]).toEqual([...STRICT_DROPPED_KEYWORDS]);
  });

  it('no keyword is both rejected and undocumented', () => {
    const overlap = STRICT_DROPPED_KEYWORDS.filter((keyword) =>
      (UNDOCUMENTED_KEYWORDS as readonly string[]).includes(keyword),
    );

    expect(overlap).toEqual([]);
  });

  it('no keyword appears in two rejection classes', () => {
    const seen = new Set<string>();
    for (const keywords of Object.values(STRICT_REJECTED_KEYWORDS)) {
      for (const keyword of keywords) {
        expect(seen.has(keyword), `${keyword} listed twice`).toBe(false);
        seen.add(keyword);
      }
    }
  });
});

describe('strict mode is never quieter than the default', () => {
  /** A schema carrying exactly one keyword, at a type that keyword applies to. */
  const carrying = (keyword: string): JsonSchema => ({
    type: 'object',
    properties: {
      value: {
        type: keyword.includes('Items') || keyword === 'uniqueItems' ? 'array' : 'string',
        [keyword]: keyword === 'uniqueItems' ? true : 3,
      },
    },
  });

  it.each([...NEVER_ENFORCED_KEYWORDS])('reports `%s` in both modes', (keyword) => {
    const schema = carrying(keyword);
    const path = `inputSchema.properties.value.${keyword}`;

    const relaxed = checkTool(tool(schema)).filter((d) => d.path === path);
    const strict = checkTool(tool(schema), { strict: true }).filter((d) => d.path === path);

    expect(relaxed.length, `default mode said nothing about ${keyword}`).toBeGreaterThan(0);
    expect(strict.length, `strict mode said nothing about ${keyword}`).toBeGreaterThan(0);
  });
});
