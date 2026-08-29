/**
 * The exact `compile()` output this package produced on `main`, before strict
 * mode existed — one entry per shared `@schemaport/core` fixture, keyed the way
 * `FIXTURE_TOOLS` is keyed.
 *
 * Captured by running `main`'s compiled `dist/` against `FIXTURE_TOOLS` and
 * serializing `result.output`. It exists so that "adding strict mode did not
 * change the default path" is a checked fact rather than a claim: the CLI calls
 * `compile(tool)` with no options and its output must stay byte-identical.
 *
 * Do not regenerate this file to make a test pass. If it disagrees with the
 * current output, the default path changed and that is the bug.
 */
export const MAIN_COMPILE_OUTPUT: Readonly<Record<string, unknown>> = Object.freeze({
  "refund_order": {
    "name": "refund_order",
    "description": "Refunds all or part of an order",
    "input_schema": {
      "type": "object",
      "properties": {
        "orderId": {
          "type": "string",
          "description": "The order to refund"
        },
        "amount": {
          "type": "number",
          "minimum": 0,
          "description": "Amount to refund. Omit to refund the full order."
        }
      },
      "required": [
        "orderId"
      ]
    }
  },
  "ping": {
    "name": "ping",
    "input_schema": {
      "type": "object",
      "properties": {}
    }
  },
  "create_ticket": {
    "name": "create_ticket",
    "description": "Creates a support ticket",
    "input_schema": {
      "type": "object",
      "properties": {
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "priority": {
          "type": "string",
          "enum": [
            "low",
            "medium",
            "high"
          ]
        },
        "escalated": {
          "type": "boolean"
        },
        "attempts": {
          "type": "integer",
          "minimum": 0,
          "maximum": 10
        },
        "labels": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "maxItems": 20
        },
        "requester": {
          "type": "object",
          "properties": {
            "email": {
              "type": "string",
              "format": "email"
            },
            "name": {
              "type": "string"
            }
          },
          "required": [
            "email"
          ]
        },
        "history": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "at": {
                "type": "string"
              },
              "note": {
                "type": "string"
              }
            },
            "required": [
              "at"
            ]
          }
        }
      },
      "required": [
        "title",
        "priority"
      ]
    }
  },
  "tag_resource": {
    "name": "tag_resource",
    "description": "Attaches arbitrary string tags to a resource",
    "input_schema": {
      "type": "object",
      "properties": {
        "resourceId": {
          "type": "string"
        },
        "tags": {
          "type": "object",
          "additionalProperties": {
            "type": "string"
          }
        }
      },
      "required": [
        "resourceId",
        "tags"
      ]
    }
  },
  "set_limit": {
    "name": "set_limit",
    "description": "Sets a numeric limit or removes it",
    "input_schema": {
      "type": "object",
      "properties": {
        "limit": {
          "anyOf": [
            {
              "type": "number",
              "minimum": 1
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "required": [
        "limit"
      ]
    }
  },
  "schedule_job": {
    "name": "schedule_job",
    "description": "Schedules a background job",
    "input_schema": {
      "type": "object",
      "properties": {
        "jobId": {
          "type": "string",
          "pattern": "^job_[a-z0-9]+$",
          "minLength": 5
        },
        "runEvery": {
          "type": "integer",
          "minimum": 60,
          "maximum": 86400,
          "multipleOf": 60
        },
        "window": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "minItems": 2,
          "maxItems": 2
        }
      },
      "required": [
        "jobId",
        "runEvery"
      ]
    }
  },
});

/**
 * `main`'s `check()`/compile diagnostics, as `severity code path` lines.
 *
 * Message *text* is deliberately not pinned: `anthropic/schema-not-enforced`
 * was reworded, because it used to say SchemaPort does not emit `strict: true`
 * and that is no longer true. Which rules fire, where, and how severely must
 * not move.
 */
export const MAIN_DIAGNOSTIC_SHAPE: Readonly<Record<string, readonly string[]>> = Object.freeze(
{
    "refund_order": [
      "warning anthropic/schema-not-enforced inputSchema",
      "warning anthropic/constraint-not-enforced inputSchema.properties.amount.minimum"
    ],
    "ping": [
      "info anthropic/missing-tool-description description"
    ],
    "create_ticket": [
      "warning anthropic/schema-not-enforced inputSchema",
      "warning anthropic/constraint-not-enforced inputSchema.properties.attempts.maximum",
      "warning anthropic/constraint-not-enforced inputSchema.properties.attempts.minimum",
      "warning anthropic/constraint-not-enforced inputSchema.properties.labels.maxItems",
      "warning anthropic/constraint-not-enforced inputSchema.properties.title.maxLength",
      "warning anthropic/constraint-not-enforced inputSchema.properties.title.minLength"
    ],
    "tag_resource": [
      "warning anthropic/schema-not-enforced inputSchema",
      "warning anthropic/constraint-not-enforced inputSchema.properties.tags.additionalProperties"
    ],
    "set_limit": [
      "warning anthropic/schema-not-enforced inputSchema",
      "warning anthropic/constraint-not-enforced inputSchema.properties.limit.anyOf[0].minimum"
    ],
    "schedule_job": [
      "warning anthropic/schema-not-enforced inputSchema",
      "warning anthropic/constraint-not-enforced inputSchema.properties.jobId.minLength",
      "warning anthropic/keyword-not-documented inputSchema.properties.jobId.pattern",
      "warning anthropic/constraint-not-enforced inputSchema.properties.runEvery.maximum",
      "warning anthropic/constraint-not-enforced inputSchema.properties.runEvery.minimum",
      "warning anthropic/constraint-not-enforced inputSchema.properties.runEvery.multipleOf",
      "warning anthropic/constraint-not-enforced inputSchema.properties.window.maxItems",
      "warning anthropic/constraint-not-enforced inputSchema.properties.window.minItems"
    ]
  },
);

/** `main`'s transformations, as `code path lossy=<bool>` lines. */
export const MAIN_TRANSFORMATIONS: Readonly<Record<string, readonly string[]>> = Object.freeze(
{
    "refund_order": [
      "renamed-input-schema-field inputSchema lossy=false"
    ],
    "ping": [
      "renamed-input-schema-field inputSchema lossy=false"
    ],
    "create_ticket": [
      "renamed-input-schema-field inputSchema lossy=false"
    ],
    "tag_resource": [
      "renamed-input-schema-field inputSchema lossy=false"
    ],
    "set_limit": [
      "renamed-input-schema-field inputSchema lossy=false"
    ],
    "schedule_job": [
      "renamed-input-schema-field inputSchema lossy=false"
    ]
  },
);
