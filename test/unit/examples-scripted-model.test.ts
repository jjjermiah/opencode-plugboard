/**
 * The scripted model's answers to the tool choices (examples/_harness/scripted-model.ts). A named choice forces its
 * tool. `required` forces only a single tool the model can fill, and only before any tool result. Everything else
 * takes the paths the scenarios use, so a forced answer cannot loop.
 */
import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { answer } from "../../examples/_harness/scripted-model.js"
import { ev, plugRequest } from "../support/fixtures.js"
import type { PlugEvent, PlugRequest, PlugTool } from "../../src/contract.js"

const scenarios = JSON.parse(await Bun.file(fileURLToPath(new URL("../../examples/_shared/scenarios.json", import.meta.url))).text())
const prompt = (id: string): string => scenarios.scenarios.find((s: { id: string }) => s.id === id).prompt

const MEAL_TOOL: PlugTool = {
  name: "final_result",
  description: "The final response",
  parameters: { type: "object", properties: { calories: { type: "number" }, protein_g: { type: "number" } } },
}
const WEATHER_TOOL: PlugTool = {
  name: "get_weather",
  description: "Get the current weather for a city.",
  parameters: { type: "object", properties: { city: { type: "string" } } },
}
const user = (text: string): PlugRequest["messages"][number] => ({ role: "user", content: [{ type: "text", text }] })
const toolResult: PlugRequest["messages"][number] = {
  role: "tool",
  content: [{ type: "tool-result", id: "call_scripted_1", name: "get_weather", output: { temp_c: 18, sky: "cloudy" } } as never],
}
const calls = (events: PlugEvent[]): PlugEvent[] => events.filter((event) => event.type === "tool-call")

describe("scripted model tool choices", () => {
  test("required with one fillable tool forces it with the meal", () => {
    const events = answer(
      plugRequest({ messages: [user(prompt("S6"))], tools: [MEAL_TOOL], toolChoice: "required" }),
    )
    expect(events[0]).toEqual(ev.call("call_scripted_1", "final_result", { calories: 180, protein_g: 13 }))
    expect(events.at(-1)).toMatchObject({ type: "finish", reason: "tool-calls" })
  })

  test("required with an unfillable single tool takes the old path, not an empty forced call", () => {
    const events = answer(plugRequest({ messages: [user(prompt("S2"))], tools: [WEATHER_TOOL], toolChoice: "required" }))
    expect(calls(events)).toEqual([ev.call("call_scripted_1", "get_weather", { city: "Paris" })])
  })

  test("a named choice forces its tool as before, whatever the schema", () => {
    const events = answer(
      plugRequest({ messages: [user(prompt("S2"))], tools: [WEATHER_TOOL], toolChoice: { type: "tool", name: "get_weather" } }),
    )
    expect(calls(events)).toEqual([ev.call("call_scripted_1", "get_weather", {})])
  })

  test("auto does not force: the meal is answered as text", () => {
    const events = answer(plugRequest({ messages: [user(prompt("S6"))], tools: [MEAL_TOOL], toolChoice: "auto" }))
    expect(calls(events)).toEqual([])
    expect(events[0]?.type).toBe("text-delta")
  })

  test("required after a tool result does not force again", () => {
    const events = answer(
      plugRequest({ messages: [user(prompt("S6")), toolResult], tools: [MEAL_TOOL], toolChoice: "required" }),
    )
    expect(calls(events)).toEqual([])
  })
})
