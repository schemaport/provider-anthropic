import type { CanonicalTool } from '@schemaport/core';

/**
 * Local fixtures for rules the shared `@schemaport/core` fixtures do not
 * exercise. Several of these are deliberately *not* valid canonical tools —
 * `validateCanonicalTool` rejects a root schema that is not an object, so those
 * shapes can only be built by hand.
 */

/** Tool name outside `^[a-zA-Z0-9_-]{1,64}$`. */
export const dottedNameTool: CanonicalTool = {
  name: 'billing.refund_order',
  description: 'Refunds an order.',
  inputSchema: { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] },
};

/** Tool name longer than 64 characters. */
export const longNameTool: CanonicalTool = {
  name: 'a'.repeat(65),
  description: 'Name is one character too long.',
  inputSchema: { type: 'object', properties: {} },
};

/** Root schema with no declared `type`. compile() adds it. */
export const untypedRootTool: CanonicalTool = {
  name: 'untyped_root',
  description: 'Root schema omits its type.',
  inputSchema: { properties: { id: { type: 'string' } }, required: ['id'] },
};

/** Root schema declaring a non-object type. Not compilable. */
export const stringRootTool: CanonicalTool = {
  name: 'string_root',
  description: 'Root schema is a string.',
  inputSchema: { type: 'string' },
};

/** `oneOf`, `not` and `prefixItems`: absent from Anthropic's documented keyword lists. */
export const undocumentedKeywordTool: CanonicalTool = {
  name: 'undocumented_keywords',
  description: 'Uses keywords Anthropic does not document either way.',
  inputSchema: {
    type: 'object',
    properties: {
      choice: { oneOf: [{ type: 'string' }, { type: 'number' }] },
      pair: { type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }] },
      anything: { not: { type: 'null' } },
      bounded: { type: 'object', minProperties: 1, maxProperties: 4 },
    },
    required: ['choice'],
  },
};

/** `enum` carrying an object value, and a string format outside the documented set. */
export const exoticValuesTool: CanonicalTool = {
  name: 'exotic_values',
  description: 'Non-primitive enum member and an undocumented string format.',
  inputSchema: {
    type: 'object',
    properties: {
      mode: { enum: ['fast', { nested: true }] },
      website: { type: 'string', format: 'iri' },
      inbox: { type: 'string', format: 'email' },
    },
    required: ['mode'],
  },
};

/** A `$ref` pointing outside the document, plus a local `$ref` that must not warn. */
export const externalRefTool: CanonicalTool = {
  name: 'external_ref',
  description: 'References another schema document.',
  inputSchema: {
    type: 'object',
    properties: {
      remote: { $ref: 'https://example.com/schemas/address.json' },
      local: { $ref: '#/$defs/localId' },
    },
    required: ['remote'],
    $defs: { localId: { type: 'string' } },
  },
};

/** An object that explicitly accepts undeclared keys. Strict mode closes it. */
export const openObjectTool: CanonicalTool = {
  name: 'open_object',
  description: 'Accepts undeclared keys, which the strict subset does not allow.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
    additionalProperties: true,
  },
};

/** Already closed and already fully required: strict mode has nothing to change. */
export const closedTool: CanonicalTool = {
  name: 'closed_object',
  description: 'Already in the shape the strict subset requires.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
    additionalProperties: false,
  },
};

/** A local `$ref`, which strict mode cannot prove is non-recursive. */
export const localRefTool: CanonicalTool = {
  name: 'local_ref',
  description: 'References a definition inside the same document.',
  inputSchema: {
    type: 'object',
    properties: { id: { $ref: '#/$defs/localId' } },
    required: ['id'],
    additionalProperties: false,
    $defs: { localId: { type: 'string' } },
  },
};
