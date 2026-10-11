import { describe, expect, test } from "bun:test"
import type { PlugGeneration } from "../../src/contract.js"
import { dropRejected } from "../../src/openai/sampling.js"

/** Every sampling parameter set to a non-default value. */
const ALL: PlugGeneration = { temperature: 0.5, topP: 0.9, frequencyPenalty: 0.5, presencePenalty: 0.5, maxTokens: 100, stop: ["END"] }

const dropped = (providerID: string, id: string, generation: PlugGeneration = ALL) => dropRejected({ providerID, id }, generation).dropped

describe("#30 dropRejected: the observed table, row by row", () => {
  const rows: Array<[string, string, string, string[]]> = [
    // Modern Claude (Opus 4.7+, every 5.x, fable) outside Copilot: no temperature, no top_p.
    ["modern Claude", "anthropic", "claude-opus-4-7", ["temperature", "top_p"]],
    ["modern Claude with a dotted version", "anthropic", "claude-sonnet-5.5", ["temperature", "top_p"]],
    ["modern Claude with a dated id", "opencode-go", "claude-haiku-5-5-20260101", ["temperature", "top_p"]],
    ["Claude fable", "anthropic", "claude-fable-5-1", ["temperature", "top_p"]],
    ["modern Claude on Copilot takes them (as probed)", "github-copilot", "claude-haiku-5.5", []],
    // Older Claude: temperature and top_p not both; top_p is the one dropped.
    ["older Claude with both set", "anthropic", "claude-sonnet-4-6", ["top_p"]],
    ["older Claude on Copilot", "github-copilot", "claude-haiku-4.5", ["top_p"]],
    ["Opus 4.6 is still older", "anthropic", "claude-opus-4-6", ["top_p"]],
    // GPT-5/6: all four outside Copilot; Copilot refuses only temperature and top_p.
    ["GPT-5", "openai", "gpt-5.5", ["temperature", "top_p", "frequency_penalty", "presence_penalty"]],
    ["GPT-6", "opencode-go", "gpt-6-luna", ["temperature", "top_p", "frequency_penalty", "presence_penalty"]],
    ["GPT-5 on Copilot", "github-copilot", "gpt-5-mini", ["temperature", "top_p"]],
    ["GPT-4o takes everything", "openai", "gpt-4o", []],
    // glm-5.3-flash: penalties only at 0.
    ["glm-5.3-flash with non-zero penalties", "opencode-go", "glm-5.3-flash", ["frequency_penalty", "presence_penalty"]],
    // kimi-k2.7-code: one fixed value each.
    ["kimi-k2.7-code with other values", "opencode-go", "kimi-k2.7-code", ["temperature", "top_p", "frequency_penalty", "presence_penalty"]],
    ["an unknown model keeps every parameter", "acme", "model-x", []],
  ]
  test.each(rows)("%s (%s/%s) drops %p", (_name, providerID, id, expected) => {
    expect(dropped(providerID, id)).toEqual(expected)
  })
})

describe("#30 dropRejected: value rules", () => {
  test("a parameter at the only value a model takes is kept", () => {
    expect(dropped("opencode-go", "kimi-k2.7-code", { temperature: 1, topP: 0.95, frequencyPenalty: 0, presencePenalty: 0 })).toEqual([])
    expect(dropped("opencode-go", "glm-5.3-flash", { frequencyPenalty: 0, presencePenalty: 0 })).toEqual([])
  })

  test("older Claude keeps temperature or top_p when only one is set", () => {
    expect(dropped("anthropic", "claude-sonnet-4-5", { temperature: 0.2 })).toEqual([])
    expect(dropped("anthropic", "claude-sonnet-4-5", { topP: 0.2 })).toEqual([])
  })

  test("parameters the caller did not send are never reported", () => {
    expect(dropped("openai", "gpt-5.5", { maxTokens: 10 })).toEqual([])
  })

  test("the returned generation lacks the dropped keys and keeps the rest", () => {
    expect(dropRejected({ providerID: "anthropic", id: "claude-opus-5" }, ALL).generation).toEqual({ frequencyPenalty: 0.5, presencePenalty: 0.5, maxTokens: 100, stop: ["END"] })
  })

  test("a model no rule matches gets its generation back untouched", () => {
    expect(dropRejected({ providerID: "acme", id: "x" }, ALL).generation).toBe(ALL)
  })

  test("the input generation is never mutated", () => {
    const input = { ...ALL }
    dropRejected({ providerID: "openai", id: "gpt-5.5" }, input)
    expect(input).toEqual(ALL)
  })
})
