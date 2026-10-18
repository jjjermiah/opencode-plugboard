/**
 * #132 The encoders still produce the goldens in test/types/wire.ts, which the type check pins to
 * the official SDK types (openai, @anthropic-ai/sdk, @google/genai). After an intended wire
 * change: `bun test/types/generate.ts`, then `bun run typecheck`.
 */
import { describe, expect, test } from "bun:test"
import { scenarios } from "../types/scenarios.js"
import * as wire from "../types/wire.js"

const s = await scenarios()
const pairs: Array<[keyof typeof wire, unknown]> = [
  ["chatCompletion", s.chat.completion],
  ["chatCompletionChunks", s.chat.chunks],
  ["chatError", s.chat.error],
  ["chatModelList", s.chat.models],
  ["responsesResponse", s.responses.response],
  ["responsesEvents", s.responses.events],
  ["completion", s.completions.completion],
  ["completionChunks", s.completions.chunks],
  ["anthropicMessage", s.messages.message],
  ["anthropicEvents", s.messages.events],
  ["anthropicError", s.messages.error],
  ["geminiResponse", s.gemini.response],
  ["geminiChunks", s.gemini.chunks],
]

describe("#132 encoder output matches the SDK-typed goldens", () => {
  test.each(pairs)("%s", (name, actual) => {
    // biome-ignore lint/performance/noDynamicNamespaceImportAccess: the golden is picked by name from the table above
    expect(actual).toEqual(wire[name])
  })

  test("every golden is checked", () => {
    expect(pairs.map(([name]) => name).sort()).toEqual(Object.keys(wire).sort() as Array<keyof typeof wire>)
  })
})
