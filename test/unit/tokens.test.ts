/**
 * #143, #144 The count endpoints' estimate: characters / 4 over everything the model reads, a fixed
 * cost per image or file. The number is an estimate by design (see src/anthropic/tokens.ts).
 */
import { describe, expect, test } from "bun:test"
import { appPolicy } from "../../src/config.js"
import { MEDIA_TOKENS, estimateTokens } from "../../src/anthropic/tokens.js"
import { requestSystem } from "../../src/session/context.js"
import { plugRequest, testOptions } from "../support/fixtures.js"

describe("#201 count_tokens counts the system prompt plugboard adds", () => {
  const base = plugRequest({ system: ["Caller prompt."] })
  const policy = (system: string, systemMode: "prepend" | "append" | "replace") => appPolicy(testOptions({ apps: { default: { system, systemMode } } }), "default")

  test("the app's system policy is part of the count: 400 characters add exactly 100 tokens", () => {
    const plain = estimateTokens({ ...base, system: requestSystem(base, [], undefined) })
    const prepended = estimateTokens({ ...base, system: requestSystem(base, [], policy("P".repeat(400), "prepend")) })
    expect(prepended - plain).toBe(100)
  })

  test("replace drops the caller's prompt from the count, so only the policy counts", () => {
    const replaced = requestSystem(base, [], policy("Only this.", "replace"))
    expect(replaced).toEqual(["Only this."])
  })

  test("a required tool choice adds its steering sentence to the count", () => {
    const steered = requestSystem({ ...base, toolChoice: "required" }, [], undefined)
    expect(steered).toEqual(["Caller prompt.", "You must respond by calling one of the provided tools."])
    expect(estimateTokens({ ...base, system: steered })).toBeGreaterThan(estimateTokens({ ...base, system: requestSystem(base, [], undefined) }))
  })

  test("the skill prelude comes before the caller's prompt", () => {
    expect(requestSystem(base, ["Skill body."], undefined)).toEqual(["Skill body.", "Caller prompt."])
  })
})

describe("#143 #144 the token estimate", () => {
  test.each([
    ["no text", [], 0],
    ["8 characters", ["abcdefgh"], 2],
    ["9 characters rounds up", ["abcdefghi"], 3],
  ])("%s", (_, texts, tokens) => {
    const messages = texts.map((text) => ({ role: "user" as const, content: [{ type: "text" as const, text }] }))
    expect(estimateTokens(plugRequest({ messages }))).toBe(tokens)
  })

  test("the system prompt counts", () => {
    expect(estimateTokens(plugRequest({ messages: [], system: ["abcdefgh"] }))).toBe(2)
  })

  test("a tool counts its name, description and schema; a tool call and its result count their payloads", () => {
    const tool = { name: "weather", description: "Weather", parameters: { type: "object" } }
    const expected = Math.ceil(("weather".length + "Weather".length + JSON.stringify(tool.parameters).length) / 4)
    expect(estimateTokens(plugRequest({ messages: [], tools: [tool] }))).toBe(expected)
    const call = plugRequest({
      messages: [
        { role: "assistant", content: [{ type: "tool-call", id: "c1", name: "weather", input: { city: "Oslo" } }] },
        { role: "tool", content: [{ type: "tool-result", id: "c1", name: "weather", result: "sunny" }] },
      ],
    })
    expect(estimateTokens(call)).toBe(Math.ceil(("weather".length + JSON.stringify({ city: "Oslo" }).length + "weather".length + "sunny".length) / 4))
  })

  test("#374 replayed reasoning counts its text, signature and redacted data", () => {
    const reasoning = plugRequest({ messages: [{ role: "assistant", content: [{ type: "reasoning", text: "plan", signature: "sig" }, { type: "reasoning", text: "", redactedData: "opaque" }] }] })
    expect(estimateTokens(reasoning)).toBe(Math.ceil(("plan".length + "sig".length + "opaque".length) / 4))
  })

  test("each image or file costs MEDIA_TOKENS, whatever its size", () => {
    const media = { type: "media" as const, url: "data:image/png;base64,AAAA", mediaType: "image/png" }
    expect(estimateTokens(plugRequest({ messages: [{ role: "user", content: [media, media] }] }))).toBe(2 * MEDIA_TOKENS)
  })
})
