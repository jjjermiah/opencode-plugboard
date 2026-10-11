/**
 * The shared scenario set of the compatibility matrix (#101): what each scenario asks, and what
 * the model behind plugboard answers. In CI the model is a `FakeModelCaller` scripted here, so the
 * matrix tests the clients and plugboard's wire formats, not a provider. Live mode (#99) will send
 * the same scenarios to real providers.
 *
 * Every client sends the scenario's tag in its first user message (`[scenario:text]`); the fake
 * model reads it back to pick its answer.
 */
import type { PlugEvent, PlugRequest } from "../../src/contract.js"
import { ev } from "../support/fixtures.js"

export const SCENARIOS = ["text", "stream", "tools", "parallel-tools", "image", "structured", "error", "usage"] as const
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
}

export const TEXT = "Hello from plugboard"
export const STREAM_DELTAS = ["Hello ", "from ", "plugboard"]
export const TOOL_ANSWER = "It is sunny in Oslo"
export const PARALLEL_ANSWER = "Sunny in Oslo, rainy in Rome"
export const STRUCTURED = { answer: "42" }
export const USAGE = { inputTokens: 11, outputTokens: 7 }
/** A 1x1 PNG. */
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
export function script(request: PlugRequest): PlugEvent[] {
  const finish = ev.finish("stop", USAGE)
  switch (scenarioOf(request)) {
    case "text":
    case "usage":
      return [ev.text(TEXT), finish]
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
