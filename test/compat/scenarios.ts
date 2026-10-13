/**
 * The shared scenario set of the compatibility matrix (#101): what each scenario asks, and what
 * the model behind plugboard answers. In CI the model is a `FakeModelCaller` scripted here, so the
 * matrix tests the clients and plugboard's wire formats, not a provider. Live mode (#99) will send
 * the same scenarios to real providers.
 *
 * Every client sends the scenario's tag in its first user message (`[scenario:text]`); the fake
 * model reads it back to pick its answer.
 */
import type { PlugRequest } from "../../src/contract.js"
import { ev } from "../support/fixtures.js"
import type { ScriptStep } from "../support/model-caller.js"

export const SCENARIOS = [
  "text",
  "stream",
  "tools",
  "parallel-tools",
  "image",
  "structured",
  "error",
  "usage",
  "multi-turn",
  "thinking",
  "stop-sequence",
  "n",
  "stream-usage",
  "developer",
  "echo-suffix",
  "count-tokens",
  "document",
  "model-id",
  "prompt-array",
  "logprobs",
  "cancel",
] as const
export type Scenario = (typeof SCENARIOS)[number]

/** What the scenarios check, for the matrix legend. */
export const SCENARIO_DESCRIPTIONS: Record<Scenario, string> = {
  text: "One prompt, one text answer.",
  stream: "The same answer streamed, reassembled by the client.",
  tools: "A tool call, the client sends the result back, the model answers (full round trip).",
  "parallel-tools": "Two tool calls in one turn, both answered.",
  image: "A PNG sent inline reaches the model as an image.",
  structured: "JSON Schema output parsed by the client.",
  error: "A provider 429 surfaces as the client's own error type with status 429.",
  usage: "Token usage is reported in the client's usage fields.",
  "multi-turn": "A second turn: the client resends the conversation with the model's answer, and the model answers from it (#103, #104).",
  thinking: "Extended thinking on: the reasoning comes back as thinking content, then the answer (#102).",
  "stop-sequence": "A stop sequence ends the answer, and the stop reason says so (#102).",
  n: "Several choices from one request (n > 1), each with its own index, streamed or not, with usage summed over the choices. Legacy completions with a prompt array times n give each choice its prompt (#106).",
  "stream-usage": "Usage arrives in the stream when the client asks for it (#106, #7).",
  developer: "A developer-role message (OpenAI's name for a system prompt) is accepted (#7).",
  "echo-suffix": "Legacy completions options: echo the prompt and take a suffix (#106).",
  "count-tokens": "Token counting before a request (count_tokens, countTokens) returns a count (#102, #103).",
  document: "A PDF sent as a document block reaches the model as a document (#102).",
  "model-id": "A model id with a `/` (provider/model) is passed through to the route unchanged (#103).",
  "prompt-array": "Legacy completions with an array prompt: one choice per prompt, each with its index (#106).",
  logprobs: "Logprobs absent: a client that does not ask gets null logprobs; one that asks is refused with a 400 (#105).",
  cancel: "The client aborts mid-stream and the server sees the abort on the model call (#101).",
}

export const TEXT = "Hello from plugboard"
export const STREAM_DELTAS = ["Hello ", "from ", "plugboard"]
export const TOOL_ANSWER = "It is sunny in Oslo"
export const PARALLEL_ANSWER = "Sunny in Oslo, rainy in Rome"
export const STRUCTURED = { answer: "42" }
/** A catalog id with a slash, sent as is (#103 model-id). */
export const CATALOG_ID = "test/echo"
export const MULTI_TURN_ANSWER = "Yes, again"
export const THINKING = "Weighing the question."
export const USAGE = { inputTokens: 11, outputTokens: 7 }
/** A 1x1 PNG. */
/** A PDF header, enough for the fake model to see a PDF went through. */
export const PDF_BASE64 = "JVBERi0xLjQK"
export const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII="

export const WEATHER_SCHEMA = { type: "object" as const, properties: { city: { type: "string" } }, required: ["city"] }
export const STRUCTURED_SCHEMA = { type: "object" as const, properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false }

export const tag = (scenario: Scenario) => `[scenario:${scenario}] Please answer.`

const scenarioOf = (request: PlugRequest): Scenario | undefined => {
  for (const message of request.messages)
    for (const part of message.content) {
      const match = part.type === "text" ? /\[scenario:([a-z-]+)\]/.exec(part.text) : null
      if (match) return match[1] as Scenario
    }
  return undefined
}

const answered = (request: PlugRequest) => request.messages.some((message) => message.role === "tool")

/** The fake model: answers each scenario the way a real model would. */
export function script(request: PlugRequest): ScriptStep[] {
  const finish = ev.finish("stop", USAGE)
  switch (scenarioOf(request)) {
    case "text":
    case "usage":
    case "n":
    case "stream-usage":
    case "developer":
    case "echo-suffix":
    case "count-tokens":
    case "model-id":
    case "prompt-array":
    case "logprobs":
      return [ev.text(TEXT), finish]
    case "cancel":
      // Some text, then no answer: the client has to abort the call.
      return [ev.text("Hel"), "hang"]
    case "document": {
      const pdf = request.messages.flatMap((message) => message.content).some((part) => part.type === "media" && part.mediaType === "application/pdf")
      return [ev.text(pdf ? "document: application/pdf" : "no document"), finish]
    }
    case "stop-sequence":
      // The sequence is part of what the model produced: plugboard must remove it and report it (#145).
      return [ev.text(`${TEXT}END`), finish]
    case "multi-turn":
      // The second user turn is the only one with more than one user message.
      return [ev.text(request.messages.filter((message) => message.role === "user").length > 1 ? MULTI_TURN_ANSWER : TEXT), finish]
    case "thinking":
      return [ev.reasoning(THINKING), ev.text(TEXT), finish]
    case "stream":
      return [...STREAM_DELTAS.map(ev.text), finish]
    case "tools":
      return answered(request) ? [ev.text(TOOL_ANSWER), finish] : [ev.call("call_1", "weather", { city: "Oslo" }), ev.finish("tool-calls", USAGE)]
    case "parallel-tools":
      return answered(request)
        ? [ev.text(PARALLEL_ANSWER), finish]
        : [ev.call("call_1", "weather", { city: "Oslo" }), ev.call("call_2", "weather", { city: "Rome" }), ev.finish("tool-calls", USAGE)]
    case "image": {
      const media = request.messages.flatMap((message) => message.content).find((part) => part.type === "media")
      return [ev.text(media && media.type === "media" && media.url.startsWith("data:image/png;base64,") ? "image: image/png" : "no image"), finish]
    }
    case "structured": {
      // Like a real model: a forced tool is called (plugboard's `respond`, or a client's own, such as
      // the AI SDK's `json` tool on Anthropic); with no tool forced, the JSON is the text.
      const choice = request.toolChoice
      const forced = typeof choice === "object" ? choice.name : choice === "required" ? request.tools[0]?.name : undefined
      return forced ? [ev.call("call_s", forced, STRUCTURED), ev.finish("tool-calls", USAGE)] : [ev.text(JSON.stringify(STRUCTURED)), finish]
    }
    case "error":
      return [ev.error({ status: 429, kind: "rate_limit", code: "rate_limited", message: "The model provider is rate limiting requests; retry later" })]
    default:
      return [ev.error({ status: 400, kind: "invalid_request", message: "No [scenario:...] tag in the request" })]
  }
}
