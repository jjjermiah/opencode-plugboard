/**
 * Gemini `generationConfig.stopSequences` (docs/gemini.md: up to 5). Five pass through to the model unchanged and
 * six is a 400 on `generationConfig.stopSequences`. The decoder is a pure function, so it must answer the same
 * every time: the fuzzer saw one 400 and one 502 for the same five-item request, and the 502 came from downstream.
 */
import { describe, expect, test } from "bun:test"
import { isPlugError } from "../../src/contract.js"
import { parseGeminiRequest } from "../../src/gemini/request.js"
import { testOptions } from "../support/fixtures.js"

const options = testOptions({})
const body = (stopSequences: unknown) => ({ contents: [{ role: "user", parts: [{ text: "hi" }] }], generationConfig: { stopSequences } })

describe("Gemini stopSequences: five pass through, six is a deterministic 400", () => {
  test("five sequences reach the model unchanged, on every parse", () => {
    const five = ["a", "b", "c", "d", "e"]
    for (let attempt = 0; attempt < 3; attempt++) {
      const parsed = parseGeminiRequest("test/echo", false, body(five), options)
      if (isPlugError(parsed)) throw new Error(`five stop sequences refused: ${parsed.message}`)
      expect(parsed.request.generation.stop).toEqual(five)
    }
  })

  test("six sequences are a 400 on generationConfig.stopSequences, on every parse", () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(parseGeminiRequest("test/echo", false, body(["a", "b", "c", "d", "e", "f"]), options)).toMatchObject({
        status: 400,
        kind: "invalid_request",
        param: "generationConfig.stopSequences",
      })
    }
  })
})
