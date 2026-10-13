/**
 * The OpenCode `models` block generator (.github/scripts/opencode-models.ts, #376): a hub's
 * `GET /v1/models` becomes `limit` and `cost` per id, and an unknown fact is left out, never zero.
 */
import { describe, expect, test } from "bun:test"
import { modelsBlock } from "../../.github/scripts/opencode-models.ts"

describe("opencode-models: a hub's /v1/models as OpenCode's models block", () => {
  test("limit from context_length and max_output_tokens; cost per million tokens with a context tier", () => {
    const block = modelsBlock({
      object: "list",
      data: [
        {
          id: "opencode-go/glm-5.3-flash",
          object: "model",
          context_length: 200_000,
          max_output_tokens: 8_000,
          pricing: { prompt: "0.000003", completion: "0.000015", input_cache_read: "0.0000003", input_cache_write: "0.00000375" },
          plugboard: {
            cost: [
              { input: 3, output: 15, cache: { read: 0.3, write: 3.75 } },
              { input: 6, output: 22.5, cache: { read: 0.6 }, aboveContext: 200_000 },
            ],
          },
        },
      ],
    })
    expect(block).toEqual({
      "opencode-go/glm-5.3-flash": {
        limit: { context: 200_000, output: 8_000 },
        cost: [
          { input: 3, output: 15, cache: { read: 0.3, write: 3.75 } },
          { input: 6, output: 22.5, cache: { read: 0.6 }, tier: { type: "context", size: 200_000 } },
        ],
      },
    })
  })

  test("a model with no known facts gets an empty entry; a base price alone is one object, not an array", () => {
    const block = modelsBlock({
      data: [
        { id: "bare", object: "model" },
        { id: "priced", object: "model", pricing: { prompt: "0.00000015", completion: "0.0000006" } },
        { id: "zero", object: "model", context_length: 1000, pricing: { prompt: "0", completion: "0" } },
      ],
    })
    expect(block).toEqual({
      bare: {},
      priced: { cost: { input: 0.15, output: 0.6 } },
      zero: { limit: { context: 1000 }, cost: { input: 0, output: 0 } },
    })
  })

  test("a #variant id is skipped; plugboard.limit.input becomes limit.input", () => {
    const block = modelsBlock({
      data: [
        { id: "openai/gpt-6.1-sol", context_length: 400000, plugboard: { limit: { input: 272000 } } },
        { id: "openai/gpt-6.1-sol#low", context_length: 400000 },
      ],
    })
    expect(Object.keys(block)).toEqual(["openai/gpt-6.1-sol"])
    expect(block["openai/gpt-6.1-sol"]).toEqual({ limit: { context: 400000, input: 272000 } })
  })

  test("a body without data is an error, not an empty block", () => {
    expect(() => modelsBlock({ error: { message: "nope" } })).toThrow("not a /v1/models body")
  })
})
