/**
 * The scripted model behind `scripted-server.ts`. It answers only the prompts in `_shared/scenarios.json`,
 * so a scripted run is byte-identical from one run to the next. Anything else gets an error event, which
 * fails the scenario instead of inventing an answer.
 *
 * Built on `FakeModelCaller` and `ev` from test/support, the same fake the HTTP tests use.
 */
import type { PlugEvent, PlugRequest } from "../../src/contract.js"
import { FakeModelCaller } from "../../test/support/model-caller.js"
import { ev } from "../../test/support/fixtures.js"
import scenarios from "../_shared/scenarios.json" with { type: "json" }

const CALL_ID = "call_scripted_1"
const USAGE = { inputTokens: 11, outputTokens: 7 }
/** The meal the model estimates, as text and as a forced tool's arguments. */
export const MEAL = { calories: 180, protein_g: 13 }

const prompt = (id: string): string => scenarios.scenarios.find((s) => s.id === id)?.prompt ?? ""
const userText = (request: PlugRequest): string =>
  request.messages
    .filter((message) => message.role === "user")
    .flatMap((message) => message.content)
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n")
const hasPngPart = (request: PlugRequest): boolean =>
  request.messages.some((message) => message.content.some((part) => part.type === "media" && part.url.startsWith("data:image/png")))
const answered = (request: PlugRequest): boolean => request.messages.some((message) => message.role === "tool")
/** n8n's Structured Output Parser puts its schema in the prompt, with the answer wrapped in `output` (#344). Other clients send no such text. */
const wantsOutputWrapper = (text: string): boolean => text.includes('"properties":{"output"')

/** Text as two deltas, so a streaming client has to accumulate. */
function say(answer: string): PlugEvent[] {
  const half = Math.ceil(answer.length / 2)
  return [ev.text(answer.slice(0, half)), ev.text(answer.slice(half)), ev.finish("stop", USAGE)]
}

const propertiesOf = (schema: unknown): object => (schema as { properties?: object } | undefined)?.properties ?? {}

/**
 * The tool a request forces, if any. A named choice always forces its tool. `required` forces only when there is exactly
 * one tool the scripted model can fill (a `calories` property, the meal), and only before any tool result, so a forced
 * answer cannot loop. Any other `required` request takes the same paths as `auto`.
 */
function forcedTool(request: PlugRequest): string | undefined {
  if (typeof request.toolChoice === "object") return request.toolChoice.name
  if (request.toolChoice !== "required" || answered(request)) return undefined
  const [tool] = request.tools
  return tool && "calories" in propertiesOf(tool.parameters) ? tool.name : undefined
}

/** The events of one model call for `request`. */
export function answer(request: PlugRequest): PlugEvent[] {
  const forced = forcedTool(request)
  if (forced) {
    const input = "calories" in propertiesOf(request.tools.find((tool) => tool.name === forced)?.parameters) ? MEAL : {}
    return [ev.call(CALL_ID, forced, input), ev.finish("tool-calls", USAGE)]
  }
  const text = userText(request)
  // DSPy's chat adapter wraps the question and wants the answer in a `[[ ## answer ## ]]` field, after `reasoning` when the
  // signature asks for it. Other clients never send these markers, so their answers are unchanged.
  if (text.includes("[[ ## ")) {
    const reasoning = text.includes("`[[ ## reasoning ## ]]`") ? "[[ ## reasoning ## ]]\nThe answer is requested.\n\n" : ""
    if (text.includes(prompt("S1"))) return say(`${reasoning}[[ ## answer ## ]]\npong\n\n[[ ## completed ## ]]`)
    if (text.includes(prompt("S6"))) return say(`${reasoning}[[ ## answer ## ]]\n${JSON.stringify(MEAL)}\n\n[[ ## completed ## ]]`)
  }
  if (text.includes(prompt("S1"))) return say("pong")
  if (text.includes(prompt("S2"))) {
    // smolagents sends the tool result as user text ("Observation:") and ends a run only with a final_answer call (#370).
    if (text.includes("Observation:") && request.tools.some((tool) => tool.name === "final_answer")) {
      return [ev.call(CALL_ID, "final_answer", { answer: "18 C and cloudy" }), ev.finish("tool-calls", USAGE)]
    }
    if (answered(request)) return say("18 C and cloudy")
    if (request.tools.some((tool) => tool.name === "get_weather") && request.toolChoice !== "none") {
      return [ev.call(CALL_ID, "get_weather", { city: "Paris" }), ev.finish("tool-calls", USAGE)]
    }
  }
  if (text.includes(prompt("S5"))) return say(hasPngPart(request) ? "red" : "no image")
  if (text.includes(prompt("S6"))) return say(JSON.stringify(wantsOutputWrapper(text) ? { output: MEAL } : MEAL))
  return [ev.error({ status: 500, kind: "server", message: `scripted model has no answer for this prompt: ${text.slice(0, 80)}` })]
}

export const scriptedModel = new FakeModelCaller((request) => answer(request))
