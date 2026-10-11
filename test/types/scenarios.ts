/**
 * The encoder outputs that `test/types/wire.ts` pins to the official SDK types (#132): one
 * representative exchange per wire shape, run through the real encoders, with volatile values
 * (ids, timestamps) replaced by fixed placeholders. `test/unit/wire.test.ts` asserts each output
 * equals its golden; the golden `satisfies` the SDK's type, so a drift on either side fails a check.
 */
import { encodeError as anthropicError, runMessage } from "../../src/anthropic/response.js"
import { completionsCodec } from "../../src/completions/response.js"
import { isPlugError, type PlugEvent } from "../../src/contract.js"
import { encodeGeminiError, encodeGeminiModelList, runGenerate } from "../../src/gemini/response.js"
import { listAvailableModels } from "../../src/models.js"
import { collectCompletion, encodeError, encodeModelList, streamCompletion } from "../../src/openai/response.js"
import { parseResponsesRequest } from "../../src/responses/request.js"
import { runResponse } from "../../src/responses/response.js"
import { CATALOG, ev, events, testOptions } from "../support/fixtures.js"
import { sseData } from "../support/loopback.js"

const USAGE = { inputTokens: 12, outputTokens: 7, reasoningTokens: 2, cacheReadTokens: 4 }
/** Text, then a tool call, then a finish with usage: exercises most fields of every format. */
const TOOL_TURN = (): PlugEvent[] => [ev.text("Checking."), ev.call("call_1", "weather", { city: "Oslo" }), ev.finish("tool-calls", USAGE)]
const TEXT_TURN = (): PlugEvent[] => [ev.text("Hello"), ev.finish("stop", USAGE)]
const FAILURE = { status: 429, kind: "rate_limit", message: "slow down", code: "rate_limited", param: "model" } as const

const VOLATILE: Array<[RegExp, string]> = [
  [/chatcmpl-[0-9a-f]{29}/g, "chatcmpl-ID"],
  [/cmpl-[0-9a-f]{29}/g, "cmpl-ID"],
  [/resp_[0-9a-f]{32}/g, "resp_ID"],
  [/msg_[0-9a-f]{32}/g, "msg_ID"],
  [/fc_[0-9a-f]{32}/g, "fc_ID"],
]
const TIME_KEYS = new Set(["created", "created_at"])

/** Placeholders for ids and timestamps; `responseId` (Gemini) too. */
export function normalize<T>(value: T): T {
  let text = JSON.stringify(value)
  for (const [pattern, placeholder] of VOLATILE) text = text.replace(pattern, placeholder)
  return JSON.parse(text, (key, item) => (TIME_KEYS.has(key) && typeof item === "number" ? 0 : key === "responseId" && typeof item === "string" ? "RESPONSE_ID" : item)) as T
}

const chatExchange = { model: "fast", stream: false, includeUsage: true }

export async function scenarios() {
  const chatStream: string[] = []
  await streamCompletion(events(...TOOL_TURN()), { ...chatExchange, stream: true }, (chunk) => void chatStream.push(chunk))

  // A realistic envelope: what the decoder echoes for a request with instructions, a tool and sampling.
  const decoded = parseResponsesRequest(
    { model: "fast", input: "weather?", instructions: "Be brief.", stream: true, temperature: 0.5, tools: [{ type: "function", name: "weather", parameters: { type: "object", properties: { city: { type: "string" } } } }] },
    testOptions(),
  )
  if (isPlugError(decoded)) throw new Error(decoded.message)
  const responsesEvents: object[] = []
  const responses = await runResponse(events(...TOOL_TURN()), decoded.exchange, (event) => void responsesEvents.push(event))

  const completions = completionsCodec({ model: "fast", stream: false, includeUsage: true, perPrompt: 1 })
  const completionStream: string[] = []
  await completions.streamChoice(events(...TEXT_TURN()), (chunk) => void completionStream.push(chunk), { id: "cmpl-ID", created: 0, index: 0 })

  const messagesEvents: object[] = []
  const message = await runMessage(events(ev.reasoning("Let me think."), ...TOOL_TURN()), { model: "fast", stream: true, thinking: true }, (event) => void messagesEvents.push(event))

  const geminiChunks: object[] = []
  const gemini = await runGenerate(events(...TOOL_TURN()), { model: "fast", stream: true }, (chunk) => void geminiChunks.push(JSON.parse(JSON.stringify(chunk))))

  const listed = listAvailableModels(testOptions({ models: ["test/echo"] }), CATALOG).slice(0, 1)
  return normalize({
    chat: {
      completion: (await collectCompletion(events(...TOOL_TURN()), chatExchange)).body,
      chunks: chatStream.flatMap(sseData),
      error: encodeError(FAILURE),
      models: encodeModelList(listed),
    },
    responses: { response: responses.response, events: responsesEvents },
    completions: { completion: (await completions.collect(events(...TEXT_TURN()), 0)).body, chunks: completionStream.flatMap(sseData) },
    messages: { message: message.message, events: messagesEvents, error: anthropicError(FAILURE) },
    gemini: { response: gemini.response, chunks: geminiChunks, error: encodeGeminiError(FAILURE), models: encodeGeminiModelList(listed) },
  })
}
