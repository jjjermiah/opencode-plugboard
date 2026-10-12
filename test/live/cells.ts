/**
 * The provider x endpoint x scenario cells shared by the live suite (#99) and the matrix (#108).
 * Each cell is one HTTP call to plugboard with a real model behind it. A scenario that an endpoint
 * does not carry is `n-a` with its reason, not a silent skip.
 */
import { MAX_TOKENS } from "./env.js"
import { authHeaders, send, sessionError, sse, type Endpoint, type SseFrame } from "./client.js"

export const ENDPOINTS: readonly Endpoint[] = ["chat", "responses", "messages", "gemini", "completions"]

export const SCENARIOS = ["text", "stream", "tool-call", "tool-result", "image", "json", "tools-json"] as const
export type Scenario = (typeof SCENARIOS)[number]

export const PATHS: Record<Endpoint, string> = {
  chat: "/v1/chat/completions",
  responses: "/v1/responses",
  messages: "/v1/messages",
  gemini: "/v1beta/models/{model}:generateContent",
  completions: "/v1/completions",
}

/** The prompts. Each asks for a short answer the verdict can check. */
const PONG = "Reply with exactly: pong"
const TOOL_PROMPT = "What is the weather in Oslo? Call the get_weather tool. Do not answer in text."
const RESULT_PROMPT = "What is the weather in Oslo? Use the get_weather tool."
const RESULT = "Sunny, 18 C"
const IMAGE_PROMPT = "What colour is this image? Answer with one word."
const JSON_PROMPT = "What is 6 times 7? Put the number in the answer field."
const CITY_PROMPT = "Give the city Oslo as JSON in the city field. Do not call any tool."
const CALL_ID = "call_1"

/** A 16x16 solid red PNG, base64. */
export const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGP4z8BAEiJN9aiGUQ1DSgMAkPn/Afnh+ngAAAAASUVORK5CYII="
const PNG_URL = `data:image/png;base64,${PNG_BASE64}`

const WEATHER = {
  name: "get_weather",
  description: "Get the current weather for a city.",
  parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
}
const ANSWER = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false }
const CITY = { type: "object", properties: { city: { type: "string" } }, required: ["city"], additionalProperties: false }
const CALL_ARGS = { city: "Oslo" }

/** Why an endpoint does not carry a scenario (null when it does). Written into the matrix. */
export function naReason(endpoint: Endpoint, scenario: Scenario): string | null {
  if (endpoint === "completions") {
    if (scenario === "tool-call" || scenario === "tool-result" || scenario === "tools-json")
      return "legacy completions: text_completion has no tool_calls field (docs/completions.md)"
    if (scenario === "image") return "legacy completions: the prompt is a string, no image input (docs/completions.md)"
  }
  if (endpoint === "messages" && scenario === "tools-json")
    return "Messages structured output is a forced tool; output_config.format is not supported (docs/messages.md)"
  return null
}

export const applicable = (endpoint: Endpoint, scenario: Scenario) => naReason(endpoint, scenario) === null

// ---------------------------------------------------------------- requests

interface Req {
  path: string
  body: Record<string, unknown>
}

const user = (text: string) => ({ role: "user", content: text })
const hasTools = (scenario: Scenario) => scenario === "tool-call" || scenario === "tool-result" || scenario === "tools-json"

/** The user prompt of the scenarios that send one. */
function promptFor(scenario: Scenario): string {
  if (scenario === "tool-call") return TOOL_PROMPT
  if (scenario === "tool-result") return RESULT_PROMPT
  if (scenario === "json") return JSON_PROMPT
  if (scenario === "tools-json") return CITY_PROMPT
  if (scenario === "image") return IMAGE_PROMPT
  return PONG
}

function chatBody(scenario: Scenario, model: string, stream: boolean): Req {
  const messages: unknown[] =
    scenario === "tool-result"
      ? [
          user(RESULT_PROMPT),
          { role: "assistant", content: null, tool_calls: [{ id: CALL_ID, type: "function", function: { name: WEATHER.name, arguments: JSON.stringify(CALL_ARGS) } }] },
          { role: "tool", tool_call_id: CALL_ID, content: RESULT },
        ]
      : scenario === "image"
        ? [{ role: "user", content: [{ type: "text", text: IMAGE_PROMPT }, { type: "image_url", image_url: { url: PNG_URL } }] }]
        : [user(promptFor(scenario))]
  const body: Record<string, unknown> = { model, messages, max_tokens: MAX_TOKENS, stream }
  if (hasTools(scenario)) body.tools = [{ type: "function", function: WEATHER }]
  if (scenario === "json") body.response_format = { type: "json_schema", json_schema: { name: "answer", schema: ANSWER, strict: true } }
  if (scenario === "tools-json") body.response_format = { type: "json_schema", json_schema: { name: "city", schema: CITY, strict: true } }
  return { path: PATHS.chat, body }
}

function responsesBody(scenario: Scenario, model: string, stream: boolean): Req {
  const input: unknown[] =
    scenario === "tool-result"
      ? [
          user(RESULT_PROMPT),
          { type: "function_call", call_id: CALL_ID, name: WEATHER.name, arguments: JSON.stringify(CALL_ARGS) },
          { type: "function_call_output", call_id: CALL_ID, output: RESULT },
        ]
      : scenario === "image"
        ? [{ role: "user", content: [{ type: "input_text", text: IMAGE_PROMPT }, { type: "input_image", image_url: PNG_URL }] }]
        : [user(promptFor(scenario))]
  const body: Record<string, unknown> = { model, input, max_output_tokens: MAX_TOKENS, stream }
  if (hasTools(scenario)) body.tools = [{ type: "function", ...WEATHER }]
  if (scenario === "json") body.text = { format: { type: "json_schema", name: "answer", schema: ANSWER, strict: true } }
  if (scenario === "tools-json") body.text = { format: { type: "json_schema", name: "city", schema: CITY, strict: true } }
  return { path: PATHS.responses, body }
}

function messagesBody(scenario: Scenario, model: string, stream: boolean): Req {
  const messages: unknown[] =
    scenario === "tool-result"
      ? [
          user(RESULT_PROMPT),
          { role: "assistant", content: [{ type: "tool_use", id: CALL_ID, name: WEATHER.name, input: CALL_ARGS }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: CALL_ID, content: RESULT }] },
        ]
      : scenario === "image"
        ? [
            {
              role: "user",
              content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: PNG_BASE64 } }, { type: "text", text: IMAGE_PROMPT }],
            },
          ]
        : [user(promptFor(scenario))]
  const body: Record<string, unknown> = { model, messages, max_tokens: MAX_TOKENS, stream }
  if (scenario === "tool-call" || scenario === "tool-result")
    body.tools = [{ name: WEATHER.name, description: WEATHER.description, input_schema: WEATHER.parameters }]
  if (scenario === "json") {
    body.tools = [{ name: "answer", description: "Answer the question.", input_schema: ANSWER }]
    body.tool_choice = { type: "tool", name: "answer" }
  }
  return { path: PATHS.messages, body }
}

function geminiBody(scenario: Scenario, model: string, stream: boolean): Req {
  const contents: unknown[] =
    scenario === "tool-result"
      ? [
          { role: "user", parts: [{ text: RESULT_PROMPT }] },
          { role: "model", parts: [{ functionCall: { name: WEATHER.name, args: CALL_ARGS } }] },
          { role: "user", parts: [{ functionResponse: { name: WEATHER.name, response: { output: RESULT } } }] },
        ]
      : scenario === "image"
        ? [{ role: "user", parts: [{ text: IMAGE_PROMPT }, { inlineData: { mimeType: "image/png", data: PNG_BASE64 } }] }]
        : [{ role: "user", parts: [{ text: promptFor(scenario) }] }]
  const generationConfig: Record<string, unknown> = { maxOutputTokens: MAX_TOKENS }
  if (scenario === "json") Object.assign(generationConfig, { responseMimeType: "application/json", responseJsonSchema: ANSWER })
  if (scenario === "tools-json") Object.assign(generationConfig, { responseMimeType: "application/json", responseJsonSchema: CITY })
  const body: Record<string, unknown> = { contents, generationConfig }
  if (hasTools(scenario))
    body.tools = [{ functionDeclarations: [{ name: WEATHER.name, description: WEATHER.description, parametersJsonSchema: WEATHER.parameters }] }]
  const method = stream ? "streamGenerateContent?alt=sse" : "generateContent"
  return { path: `/v1beta/models/${encodeURIComponent(model)}:${method}`, body }
}

function completionsBody(scenario: Scenario, model: string, stream: boolean): Req {
  const body: Record<string, unknown> = { model, prompt: promptFor(scenario), max_tokens: MAX_TOKENS, stream }
  if (scenario === "json") body.response_format = { type: "json_schema", json_schema: { name: "answer", schema: ANSWER, strict: true } }
  return { path: PATHS.completions, body }
}

export function requestFor(endpoint: Endpoint, scenario: Scenario, model: string, stream: boolean): Req {
  if (endpoint === "chat") return chatBody(scenario, model, stream)
  if (endpoint === "responses") return responsesBody(scenario, model, stream)
  if (endpoint === "messages") return messagesBody(scenario, model, stream)
  if (endpoint === "gemini") return geminiBody(scenario, model, stream)
  return completionsBody(scenario, model, stream)
}

// ---------------------------------------------------------------- reading answers

export interface Answer {
  text: string
  calls: Array<{ name: string; args: string }>
}

const jsonOf = (text: string): any => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Read a complete (non-stream) body. */
export function readAnswer(endpoint: Endpoint, scenario: Scenario, body: any): Answer {
  const answer: Answer = { text: "", calls: [] }
  if (endpoint === "chat") {
    const message = body.choices?.[0]?.message ?? {}
    answer.text = message.content ?? ""
    for (const call of message.tool_calls ?? []) answer.calls.push({ name: call.function.name, args: call.function.arguments })
  } else if (endpoint === "responses") {
    for (const item of body.output ?? []) {
      if (item.type === "message") for (const part of item.content ?? []) if (part.type === "output_text") answer.text += part.text
      if (item.type === "function_call") answer.calls.push({ name: item.name, args: item.arguments })
    }
  } else if (endpoint === "messages") {
    for (const block of body.content ?? []) {
      if (block.type === "text") answer.text += block.text
      if (block.type === "tool_use") answer.calls.push({ name: block.name, args: JSON.stringify(block.input) })
    }
    // Messages carries structured output as a forced tool: its input is the answer.
    if (scenario === "json" && answer.calls.length === 1) answer.text = answer.calls[0]!.args
  } else if (endpoint === "gemini") {
    for (const part of body.candidates?.[0]?.content?.parts ?? []) {
      if (typeof part.text === "string") answer.text += part.text
      if (part.functionCall) answer.calls.push({ name: part.functionCall.name, args: JSON.stringify(part.functionCall.args ?? {}) })
    }
  } else {
    answer.text = body.choices?.[0]?.text ?? ""
  }
  return answer
}

/** Read the frames of a stream: the text, the tool calls and whether the stream ended properly. */
export function readStream(endpoint: Endpoint, frames: SseFrame[]): Answer & { done: boolean } {
  const answer: Answer & { done: boolean } = { text: "", calls: [], done: false }
  for (const frame of frames) {
    const data = jsonOf(frame.data)
    if (frame.data === "[DONE]") answer.done = true
    if (endpoint === "chat" && frame.data !== "[DONE]") answer.text += data?.choices?.[0]?.delta?.content ?? ""
    if (endpoint === "completions" && frame.data !== "[DONE]") answer.text += data?.choices?.[0]?.text ?? ""
    if (endpoint === "responses") {
      if (frame.event === "response.output_text.delta") answer.text += data?.delta ?? ""
      if (frame.event === "response.completed") answer.done = true
    }
    if (endpoint === "messages") {
      if (frame.event === "content_block_delta" && data?.delta?.type === "text_delta") answer.text += data.delta.text
      if (frame.event === "message_stop") answer.done = true
    }
    if (endpoint === "gemini") {
      const candidate = data?.candidates?.[0]
      for (const part of candidate?.content?.parts ?? []) {
        if (typeof part.text === "string") answer.text += part.text
        if (part.functionCall) answer.calls.push({ name: part.functionCall.name, args: JSON.stringify(part.functionCall.args ?? {}) })
      }
      if (candidate?.finishReason) answer.done = true
    }
  }
  return answer
}

// ---------------------------------------------------------------- verdicts

export type Status = "pass" | "fail" | "n-a"

export interface Cell {
  model: string
  endpoint: Endpoint
  scenario: Scenario
  status: Status
  /** Why it failed or does not apply, or "ok". Short, with no secrets. */
  detail: string
  /** Sessions the call created (from `x-plugboard-session`). */
  sessions: string[]
  ms: number
}

/** The check for one scenario. Returns the problem, or null when the answer is right. */
export function verdict(scenario: Scenario, answer: Answer): string | null {
  const text = answer.text.trim()
  const calls = answer.calls
  switch (scenario) {
    case "text":
    case "stream":
      return /pong/i.test(text) ? null : `no "pong" in the text`
    case "tool-call":
      return calls.some((call) => call.name === WEATHER.name && /oslo/i.test(call.args)) ? null : `no ${WEATHER.name} call for Oslo`
    case "tool-result":
      return /sunny|18/i.test(text) ? null : `answer ignores the tool result`
    case "image":
      return /red/i.test(text) ? null : `image not described as red`
    case "json": {
      const parsed = jsonOf(text)
      return parsed && String(parsed.answer).trim() === "42" ? null : `JSON answer is not 42`
    }
    case "tools-json": {
      const parsed = jsonOf(text)
      if (calls.length > 0) return `a tool was called instead of the JSON answer`
      return parsed && /oslo/i.test(String(parsed.city)) ? null : `JSON city is not Oslo`
    }
  }
}

/** Shorten a body for a table cell. */
export const snippet = (text: string, max = 140) => text.replace(/\s+/g, " ").trim().slice(0, max)

/** One call for one cell. The verdict carries its evidence. */
export async function runCell(model: string, endpoint: Endpoint, scenario: Scenario): Promise<Cell> {
  const started = Date.now()
  const base = { model, endpoint, scenario }
  const na = naReason(endpoint, scenario)
  if (na) return { ...base, status: "n-a", detail: na, sessions: [], ms: 0 }

  const stream = scenario === "stream"
  const req = requestFor(endpoint, scenario, model, stream)
  const sent = await send(req.path.replace("{model}", encodeURIComponent(model)), authHeaders(endpoint), req.body)
  const sessions = (sent.headers.get("x-plugboard-session") ?? "").split(",").map((id) => id.trim()).filter(Boolean)
  const ms = Date.now() - started
  const fail = (detail: string) => ({ ...base, status: "fail" as const, detail, sessions, ms })

  if (sent.status !== 200) {
    // The provider's reason is in the session, not in plugboard's generic 502.
    const why = sessions[0] ? await sessionError(sessions[0]).catch(() => undefined) : undefined
    return fail(`HTTP ${sent.status}: ${snippet(sent.text, 100)}${why ? ` | provider: ${snippet(why, 160)}` : ""}`)
  }
  if (stream) {
    const answer = readStream(endpoint, sse(sent.text))
    if (!answer.done) return fail(`stream ended without its terminator; text: ${snippet(answer.text, 80)}`)
    const problem = verdict("stream", answer)
    return problem ? fail(`${problem}; got ${snippet(answer.text, 100)}`) : { ...base, status: "pass", detail: "ok", sessions, ms }
  }
  const body = jsonOf(sent.text)
  if (body === undefined) return fail(`not JSON: ${snippet(sent.text)}`)
  const answer = readAnswer(endpoint, scenario, body)
  const problem = verdict(scenario, answer)
  if (problem) return fail(`${problem}; got ${snippet(answer.text || JSON.stringify(answer.calls) || JSON.stringify(body), 100)}`)
  return { ...base, status: "pass", detail: "ok", sessions, ms }
}
