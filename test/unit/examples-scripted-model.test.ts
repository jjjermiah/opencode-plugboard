/**
 * The scripted model's answers to the tool choices (examples/_harness/scripted-model.ts). A named choice forces its
 * tool. `required` forces only a single tool the model can fill, and only before any tool result. Everything else
 * takes the paths the scenarios use, so a forced answer cannot loop.
 */
import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { answer, PR_REVIEW } from "../../examples/_harness/scripted-model.js"
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

/** The text the scripted model streams for a request: its text-delta events joined. */
const textOf = (events: PlugEvent[]): string => events.map((event) => (event.type === "text-delta" ? event.text : "")).join("")

describe("scripted model DSPy answers", () => {
  // DSPy's chat adapter wraps the question in [[ ## field ## ]] markers and asks for the answer in an `answer` field.
  const dspy = (text: string): PlugRequest => plugRequest({ messages: [user(`[[ ## question ## ]]\n${text}\n\nRespond with the fields [[ ## answer ## ]]`)] })

  test("S1 answers in the answer field, followed by the completed marker", () => {
    const text = textOf(answer(dspy(prompt("S1"))))
    expect(text).toBe("[[ ## answer ## ]]\npong\n\n[[ ## completed ## ]]")
  })

  test("S6 answers the meal JSON in the answer field", () => {
    const text = textOf(answer(dspy(prompt("S6"))))
    expect(text).toBe(`[[ ## answer ## ]]\n${JSON.stringify({ calories: 180, protein_g: 13 })}\n\n[[ ## completed ## ]]`)
  })

  test("a signature with a reasoning field gets the reasoning before the answer", () => {
    const request = plugRequest({
      messages: [user(`[[ ## question ## ]]\n${prompt("S1")}\n\nRespond with [[ ## reasoning ## ]] then [[ ## answer ## ]]. Use \`[[ ## reasoning ## ]]\`.`)],
    })
    expect(textOf(answer(request))).toMatch(/^\[\[ ## reasoning ## \]\]\nThe answer is requested\.\n\n\[\[ ## answer ## \]\]\npong/)
  })

  test("a DSPy request for another prompt gets the scripted error, not an invented answer", () => {
    const events = answer(dspy("Something the scripted model has no answer for"))
    expect(events.some((event) => event.type === "error")).toBe(true)
  })

  test("other clients' requests (no DSPy markers) keep the plain S1 answer", () => {
    expect(textOf(answer(plugRequest({ messages: [user(prompt("S1"))] })))).toBe("pong")
  })
})

describe("scripted model PR-Agent review (examples/pr-agent)", () => {
  const review = (diff: string): PlugRequest => plugRequest({ system: ["You are PR-Reviewer"], messages: [user(`--PR Info--\n\nTitle: 'x'\n\nThe PR code diff:\n======\n${diff}\n======`)] })

  test("a review prompt gets the YAML review, with the finding the runner looks for", () => {
    const text = textOf(answer(review("+print('hi')")))
    expect(text).toContain("review:\n")
    expect(text).toContain(PR_REVIEW.header)
    expect(text).toContain(PR_REVIEW.content)
    expect(answer(review("+print('hi')")).at(-1)).toMatchObject({ type: "finish", reason: "stop" })
  })

  test("a prompt with only one of the two PR-Agent markers gets the scripted error", () => {
    expect(answer(plugRequest({ messages: [user("--PR Info--\nsomething")] })).some((event) => event.type === "error")).toBe(true)
    expect(answer(plugRequest({ messages: [user("The PR code diff:\nsomething")] })).some((event) => event.type === "error")).toBe(true)
  })
})

describe("scripted model Claude Code runs (examples/claude-code)", () => {
  const ENV = "# Environment\n - Primary working directory: /w/ws\n - Platform: linux"
  const claude = (messages: PlugRequest["messages"], system: string[] = [ENV]): PlugRequest => plugRequest({ system, messages })
  const result = (name: string, text: string): PlugRequest["messages"][number] => ({ role: "tool", content: [{ type: "tool-result", id: `toolu_${name}`, name, result: text }] })
  const assistant: PlugRequest["messages"][number] = { role: "assistant", content: [{ type: "text", text: "noted" }] }
  const callOf = (events: PlugEvent[]) => calls(events)[0] as { name: string; input: unknown } | undefined

  test("S11 writes notes.txt in the working directory the system prompt names, reads it back, then answers", () => {
    const first = answer(claude([user(prompt("S11"))]))
    expect(callOf(first)).toMatchObject({ name: "Write", input: { file_path: "/w/ws/notes.txt", content: "plugboard\n" } })
    const second = answer(claude([user(prompt("S11")), result("Write", "ok")]))
    expect(callOf(second)).toMatchObject({ name: "Read", input: { file_path: "/w/ws/notes.txt" } })
    const third = answer(claude([user(prompt("S11")), result("Write", "ok"), result("Read", "plugboard")]))
    expect(calls(third)).toEqual([])
    expect(textOf(third)).toBe("done")
  })

  test("S11 without a working directory in the system prompt gets the scripted error, not a guessed path", () => {
    expect(answer(claude([user(prompt("S11"))], [])).some((event) => event.type === "error")).toBe(true)
  })

  test("S12 calls the Agent tool once, answers the sub-agent's own request, and passes its reply on", () => {
    const main = answer(claude([user(prompt("S12"))]))
    expect(callOf(main)).toMatchObject({ name: "Agent", input: { prompt: "What is the secret word? Reply with the word only.", run_in_background: false } })
    // The sub-agent's request holds only its own prompt, so it is not asked to call the Agent tool again.
    const nested = answer(claude([user("What is the secret word? Reply with the word only.")]))
    expect(calls(nested)).toEqual([])
    expect(textOf(nested)).toBe("The secret word is marmot.")
    const done = answer(claude([user(prompt("S12")), result("Agent", "[hand-back]\n  The secret word is marmot.\nagentId: abc")]))
    expect(textOf(done)).toBe("The sub-agent said: marmot")
  })

  test("S13 answers the first turn, the compaction request with a summary, and a compacted history with what it saw", () => {
    expect(textOf(answer(claude([user(prompt("S13"))])))).toBe("noted")
    const compaction = user(`Your task is to create a detailed summary of the conversation so far, for the prompt: ${prompt("S13")}`)
    expect(textOf(answer(claude([user(prompt("S13")), assistant, compaction])))).toContain("scripted summary")
    const summary = user("Summary:\nscripted summary: the user asked to remember 42.")
    expect(textOf(answer(claude([summary, user(prompt("S13"))])))).toBe("summary only")
    expect(textOf(answer(claude([summary, assistant, user(prompt("S13"))])))).toBe("summary and old turns")
  })

  test("a plain S1 prompt from Claude Code keeps its pong", () => {
    expect(textOf(answer(claude([user(prompt("S1"))])))).toBe("pong")
  })
})

describe("scripted model tool choices", () => {
  test("required with one fillable tool forces it with the meal", () => {
    const events = answer(plugRequest({ messages: [user(prompt("S6"))], tools: [MEAL_TOOL], toolChoice: "required" }))
    expect(events[0]).toEqual(ev.call("call_scripted_1", "final_result", { calories: 180, protein_g: 13 }))
    expect(events.at(-1)).toMatchObject({ type: "finish", reason: "tool-calls" })
  })

  test("required with an unfillable single tool takes the old path, not an empty forced call", () => {
    const events = answer(plugRequest({ messages: [user(prompt("S2"))], tools: [WEATHER_TOOL], toolChoice: "required" }))
    expect(calls(events)).toEqual([ev.call("call_scripted_1", "get_weather", { city: "Paris" })])
  })

  test("calls a get_weather tool with a server prefix (Codex's MCP tools) under the name the client sent", () => {
    const events = answer(plugRequest({ messages: [user(prompt("S2"))], tools: [{ ...WEATHER_TOOL, name: "mcp__weather__get_weather" }] }))
    expect(calls(events)).toEqual([ev.call("call_scripted_1", "mcp__weather__get_weather", { city: "Paris" })])
  })

  test("a named choice forces its tool as before, whatever the schema", () => {
    const events = answer(plugRequest({ messages: [user(prompt("S2"))], tools: [WEATHER_TOOL], toolChoice: { type: "tool", name: "get_weather" } }))
    expect(calls(events)).toEqual([ev.call("call_scripted_1", "get_weather", {})])
  })

  test("auto does not force: the meal is answered as text", () => {
    const events = answer(plugRequest({ messages: [user(prompt("S6"))], tools: [MEAL_TOOL], toolChoice: "auto" }))
    expect(calls(events)).toEqual([])
    expect(events[0]?.type).toBe("text-delta")
  })

  test("required after a tool result does not force again", () => {
    const events = answer(plugRequest({ messages: [user(prompt("S6")), toolResult], tools: [MEAL_TOOL], toolChoice: "required" }))
    expect(calls(events)).toEqual([])
  })
})

describe("scripted model smolagents final answer (#370)", () => {
  const FINAL_TOOL: PlugTool = {
    name: "final_answer",
    description: "Give the final answer",
    parameters: { type: "object", properties: { answer: { type: "string" } } },
  }
  const observation = user(`New task:\n${prompt("S2")}\nObservation:\n{"temp_c": 18, "sky": "cloudy"}`)

  test("an Observation: turn with a final_answer tool is answered with a final_answer call", () => {
    const events = answer(plugRequest({ messages: [observation], tools: [WEATHER_TOOL, FINAL_TOOL] }))
    expect(calls(events)).toEqual([ev.call("call_scripted_1", "final_answer", { answer: "18 C and cloudy" })])
    expect(events.at(-1)).toMatchObject({ type: "finish", reason: "tool-calls" })
  })

  test("without a final_answer tool the Observation turn keeps the old path (the get_weather loop)", () => {
    const events = answer(plugRequest({ messages: [observation], tools: [WEATHER_TOOL] }))
    expect(calls(events)).toEqual([ev.call("call_scripted_1", "get_weather", { city: "Paris" })])
  })
})
