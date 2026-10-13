/**
 * The clients of the compatibility matrix (#101): each official SDK, run the way its docs show,
 * pointed at plugboard. A client has a case per scenario it runs; a scenario it does not apply to
 * is `na` with the reason (#148); a scenario with neither is a todo. A case marked `gap` is a known
 * incompatibility that is expected to fail until fixed.
 *
 * SDK retries are off, so the error scenario fails fast instead of backing off.
 */
import Anthropic from "@anthropic-ai/sdk"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createGoogle } from "@ai-sdk/google"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { GoogleGenAI, type Content } from "@google/genai"
import { APICallError, generateText, jsonSchema, Output, stepCountIs, streamText, tool, type LanguageModel } from "ai"
import { expect } from "bun:test"
import OpenAI from "openai"
import type { FakeModelCaller } from "../support/model-caller.js"
import { serverSawAbort } from "./abort.js"
import { LANGCHAIN_CLIENTS } from "./langchain.js"
import { CATALOG_ID, MULTI_TURN_ANSWER, PARALLEL_ANSWER, PDF_BASE64, PNG_BASE64, STREAM_DELTAS, STRUCTURED, STRUCTURED_SCHEMA, TEXT, THINKING, TOOL_ANSWER, USAGE, WEATHER_SCHEMA, tag, type Scenario } from "./scenarios.js"

export const ENDPOINTS = {
  chat: "POST /v1/chat/completions",
  responses: "POST /v1/responses",
  completions: "POST /v1/completions",
  messages: "POST /v1/messages",
  gemini: "POST /v1beta/models/{model}:generateContent",
} as const
export type Endpoint = keyof typeof ENDPOINTS

/** Where plugboard listens, the key of the app the matrix runs as, and the model caller behind it. */
export interface Target {
  readonly origin: string
  readonly apiKey: string
  readonly caller: FakeModelCaller
}

export type Run = (target: Target) => Promise<void>
export type Case = Run | { readonly gap: string; readonly run: Run }

export interface Client {
  /** Display name: the package as an app developer knows it. */
  readonly name: string
  readonly endpoint: Endpoint
  readonly cases: Partial<Record<Scenario, Case>>
  /** Scenarios that do not apply to this client, each with the reason (#148). A scenario in neither `cases` nor `na` is a todo. */
  readonly na?: Partial<Record<Scenario, string>>
}

const MODEL = "fast"
const png = () => Uint8Array.from(atob(PNG_BASE64), (char) => char.charCodeAt(0))

/** Runs `call` and requires it to reject with a 429 in the SDK's own error type. */
async function expect429(call: () => Promise<unknown>, type: abstract new (...args: never[]) => { status?: number }) {
  const error = await call().then(
    () => undefined,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(type)
  expect((error as { status?: number }).status).toBe(429)
}

const NA_RESPONSES_STOP = "the Responses API has no stop parameter"
const NA_RESPONSES_THINKING = "plugboard drops reasoning on /v1/responses (no reasoning items)"
const NA_LEGACY = "echo and suffix are legacy completions options"
const NA_NO_COUNT = "OpenAI has no token-count endpoint; clients count locally"
const NA_NO_LOGPROBS = "logprobs are a Chat Completions and legacy completions field; plugboard refuses top_logprobs on /v1/responses"

// ---------------------------------------------------------------- openai

const openai = ({ origin, apiKey }: Target) => new OpenAI({ baseURL: `${origin}/v1`, apiKey, maxRetries: 0 })
const weatherTool: OpenAI.Chat.Completions.ChatCompletionTool = { type: "function", function: { name: "weather", description: "Weather in a city", parameters: WEATHER_SCHEMA } }
const pdfDataUrl = `data:application/pdf;base64,${PDF_BASE64}`

const openaiChat: Client = {
  name: "openai",
  endpoint: "chat",
  cases: {
    text: async (target) => {
      const completion = await openai(target).chat.completions.create({ model: MODEL, messages: [{ role: "user", content: tag("text") }] })
      expect(completion.choices[0]!.message.content).toBe(TEXT)
    },
    stream: async (target) => {
      const stream = await openai(target).chat.completions.create({ model: MODEL, stream: true, messages: [{ role: "user", content: tag("stream") }] })
      let text = ""
      for await (const chunk of stream) text += chunk.choices[0]?.delta.content ?? ""
      expect(text).toBe(STREAM_DELTAS.join(""))
    },
    tools: async (target) => {
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [{ role: "user", content: tag("tools") }]
      const first = await openai(target).chat.completions.create({ model: MODEL, messages, tools: [weatherTool] })
      const call = first.choices[0]!.message.tool_calls![0]! as OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall
      expect(first.choices[0]!.finish_reason).toBe("tool_calls")
      expect(JSON.parse(call.function.arguments)).toEqual({ city: "Oslo" })
      messages.push(first.choices[0]!.message, { role: "tool", tool_call_id: call.id, content: "sunny" })
      const second = await openai(target).chat.completions.create({ model: MODEL, messages, tools: [weatherTool] })
      expect(second.choices[0]!.message.content).toBe(TOOL_ANSWER)
    },
    "parallel-tools": async (target) => {
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [{ role: "user", content: tag("parallel-tools") }]
      const first = await openai(target).chat.completions.create({ model: MODEL, messages, tools: [weatherTool] })
      const calls = first.choices[0]!.message.tool_calls!
      expect(calls).toHaveLength(2)
      messages.push(first.choices[0]!.message, ...calls.map((call) => ({ role: "tool" as const, tool_call_id: call.id, content: "ok" })))
      expect((await openai(target).chat.completions.create({ model: MODEL, messages, tools: [weatherTool] })).choices[0]!.message.content).toBe(PARALLEL_ANSWER)
    },
    image: async (target) => {
      const completion = await openai(target).chat.completions.create({
        model: MODEL,
        messages: [{ role: "user", content: [{ type: "text", text: tag("image") }, { type: "image_url", image_url: { url: `data:image/png;base64,${PNG_BASE64}` } }] }],
      })
      expect(completion.choices[0]!.message.content).toBe("image: image/png")
    },
    document: async (target) => {
      const completion = await openai(target).chat.completions.create({
        model: MODEL,
        messages: [{ role: "user", content: [{ type: "text", text: tag("document") }, { type: "file", file: { filename: "a.pdf", file_data: pdfDataUrl } }] }],
      })
      expect(completion.choices[0]!.message.content).toBe("document: application/pdf")
    },
    structured: async (target) => {
      const completion = await openai(target).chat.completions.create({
        model: MODEL,
        messages: [{ role: "user", content: tag("structured") }],
        response_format: { type: "json_schema", json_schema: { name: "answer", schema: STRUCTURED_SCHEMA, strict: true } },
      })
      expect(JSON.parse(completion.choices[0]!.message.content!)).toEqual(STRUCTURED)
    },
    error: (target) => expect429(() => openai(target).chat.completions.create({ model: MODEL, messages: [{ role: "user", content: tag("error") }] }), OpenAI.APIError),
    usage: async (target) => {
      const { usage } = await openai(target).chat.completions.create({ model: MODEL, messages: [{ role: "user", content: tag("usage") }] })
      expect(usage).toMatchObject({ prompt_tokens: USAGE.inputTokens, completion_tokens: USAGE.outputTokens, total_tokens: USAGE.inputTokens + USAGE.outputTokens })
    },
    "multi-turn": async (target) => {
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "user", content: tag("multi-turn") },
        { role: "assistant", content: TEXT },
        { role: "user", content: "Again?" },
      ]
      expect((await openai(target).chat.completions.create({ model: MODEL, messages })).choices[0]!.message.content).toBe(MULTI_TURN_ANSWER)
    },
    developer: async (target) => {
      const completion = await openai(target).chat.completions.create({ model: MODEL, messages: [{ role: "developer", content: "Be brief." }, { role: "user", content: tag("developer") }] })
      expect(completion.choices[0]!.message.content).toBe(TEXT)
    },
    n: async (target) => {
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [{ role: "user", content: tag("n") }]
      const completion = await openai(target).chat.completions.create({ model: MODEL, n: 2, messages })
      expect(completion.choices.map((choice) => [choice.index, choice.message.content])).toEqual([
        [0, TEXT],
        [1, TEXT],
      ])
      // Usage is summed over the choices: each one is a full model call.
      expect(completion.usage).toMatchObject({ prompt_tokens: 2 * USAGE.inputTokens, completion_tokens: 2 * USAGE.outputTokens, total_tokens: 2 * (USAGE.inputTokens + USAGE.outputTokens) })
      // Streamed: the chunks of each choice carry its own index, so the client reassembles per choice.
      const stream = await openai(target).chat.completions.create({ model: MODEL, n: 2, stream: true, stream_options: { include_usage: true }, messages })
      const text: Record<number, string> = {}
      const chunks: OpenAI.Chat.Completions.ChatCompletionChunk[] = []
      for await (const chunk of stream) {
        chunks.push(chunk)
        for (const choice of chunk.choices) text[choice.index] = (text[choice.index] ?? "") + (choice.delta.content ?? "")
      }
      expect([text[0], text[1]]).toEqual([TEXT, TEXT])
      // The usage chunk comes last, has no choices, and carries the sum over both.
      const last = chunks.at(-1)!
      expect(last.choices).toEqual([])
      expect(last.usage).toMatchObject({ prompt_tokens: 2 * USAGE.inputTokens, completion_tokens: 2 * USAGE.outputTokens })
    },
    "stream-usage": async (target) => {
      const stream = await openai(target).chat.completions.create({ model: MODEL, stream: true, stream_options: { include_usage: true }, messages: [{ role: "user", content: tag("stream-usage") }] })
      let usage: OpenAI.CompletionUsage | null | undefined
      for await (const chunk of stream) usage = chunk.usage ?? usage
      expect(usage).toMatchObject({ prompt_tokens: USAGE.inputTokens, completion_tokens: USAGE.outputTokens })
    },
    "model-id": async (target) => {
      expect((await openai(target).chat.completions.create({ model: CATALOG_ID, messages: [{ role: "user", content: tag("model-id") }] })).choices[0]!.message.content).toBe(TEXT)
    },
    // The sequence is part of the model's output; OpenAI's stop excludes it, and plugboard removes it too (#149).
    "stop-sequence": async (target) => {
      const completion = await openai(target).chat.completions.create({ model: MODEL, stop: ["END"], messages: [{ role: "user", content: tag("stop-sequence") }] })
      expect(completion.choices[0]!.message.content).toBe(TEXT)
    },
    logprobs: async (target) => {
      const completion = await openai(target).chat.completions.create({ model: MODEL, messages: [{ role: "user", content: tag("logprobs") }] })
      expect(completion.choices[0]!.logprobs ?? null).toBeNull()
      const error = await openai(target)
        .chat.completions.create({ model: MODEL, logprobs: true, messages: [{ role: "user", content: tag("logprobs") }] })
        .then(
          () => undefined,
          (caught: unknown) => caught,
        )
      expect(error).toBeInstanceOf(OpenAI.BadRequestError)
    },
    cancel: async (target) => {
      const controller = new AbortController()
      const stream = await openai(target).chat.completions.create({ model: MODEL, stream: true, messages: [{ role: "user", content: tag("cancel") }] }, { signal: controller.signal })
      for await (const chunk of stream)
        if (chunk.choices[0]?.delta.content) {
          controller.abort()
          break
        }
      await serverSawAbort(target)
    },
  },
  na: {
    thinking: "Chat Completions has no thinking blocks",
    "echo-suffix": NA_LEGACY,
    "count-tokens": NA_NO_COUNT,
    "prompt-array": "a prompt array is a legacy completions field",
  },
}

const responsesTool: OpenAI.Responses.FunctionTool = { type: "function", name: "weather", description: "Weather in a city", parameters: WEATHER_SCHEMA, strict: false }

const openaiResponses: Client = {
  name: "openai",
  endpoint: "responses",
  cases: {
    text: async (target) => {
      expect((await openai(target).responses.create({ model: MODEL, input: tag("text") })).output_text).toBe(TEXT)
    },
    stream: async (target) => {
      const stream = await openai(target).responses.create({ model: MODEL, input: tag("stream"), stream: true })
      let text = ""
      for await (const event of stream) if (event.type === "response.output_text.delta") text += event.delta
      expect(text).toBe(STREAM_DELTAS.join(""))
      // The SDK's helper: streams the same events and resolves to the final response.
      const helper = openai(target).responses.stream({ model: MODEL, input: tag("stream") })
      expect((await helper.finalResponse()).output_text).toBe(TEXT)
    },
    tools: async (target) => {
      const input: OpenAI.Responses.ResponseInput = [{ role: "user", content: tag("tools") }]
      const first = await openai(target).responses.create({ model: MODEL, input, tools: [responsesTool] })
      const call = first.output.find((item) => item.type === "function_call")!
      expect(JSON.parse(call.arguments)).toEqual({ city: "Oslo" })
      input.push(call, { type: "function_call_output", call_id: call.call_id, output: "sunny" })
      expect((await openai(target).responses.create({ model: MODEL, input, tools: [responsesTool] })).output_text).toBe(TOOL_ANSWER)
    },
    "parallel-tools": async (target) => {
      const input: OpenAI.Responses.ResponseInput = [{ role: "user", content: tag("parallel-tools") }]
      const first = await openai(target).responses.create({ model: MODEL, input, tools: [responsesTool] })
      const calls = first.output.filter((item) => item.type === "function_call")
      expect(calls).toHaveLength(2)
      input.push(...calls, ...calls.map((call) => ({ type: "function_call_output" as const, call_id: call.call_id, output: "ok" })))
      expect((await openai(target).responses.create({ model: MODEL, input, tools: [responsesTool] })).output_text).toBe(PARALLEL_ANSWER)
    },
    image: async (target) => {
      const response = await openai(target).responses.create({
        model: MODEL,
        input: [{ role: "user", content: [{ type: "input_text", text: tag("image") }, { type: "input_image", image_url: `data:image/png;base64,${PNG_BASE64}`, detail: "auto" }] }],
      })
      expect(response.output_text).toBe("image: image/png")
    },
    document: async (target) => {
      const response = await openai(target).responses.create({
        model: MODEL,
        input: [{ role: "user", content: [{ type: "input_text", text: tag("document") }, { type: "input_file", filename: "a.pdf", file_data: pdfDataUrl }] }],
      })
      expect(response.output_text).toBe("document: application/pdf")
    },
    structured: async (target) => {
      const response = await openai(target).responses.create({ model: MODEL, input: tag("structured"), text: { format: { type: "json_schema", name: "answer", schema: STRUCTURED_SCHEMA, strict: true } } })
      expect(JSON.parse(response.output_text)).toEqual(STRUCTURED)
    },
    error: (target) => expect429(() => openai(target).responses.create({ model: MODEL, input: tag("error") }), OpenAI.APIError),
    usage: async (target) => {
      expect((await openai(target).responses.create({ model: MODEL, input: tag("usage") })).usage).toMatchObject({ input_tokens: USAGE.inputTokens, output_tokens: USAGE.outputTokens })
    },
    // Stateless multi-turn, as `store: false` clients send it: the earlier answer goes back as a message, not an item reference.
    "multi-turn": async (target) => {
      const response = await openai(target).responses.create({
        model: MODEL,
        store: false,
        input: [{ role: "user", content: tag("multi-turn") }, { role: "assistant", content: TEXT }, { role: "user", content: "Again?" }],
      })
      expect(response.output_text).toBe(MULTI_TURN_ANSWER)
    },
    developer: async (target) => {
      expect((await openai(target).responses.create({ model: MODEL, input: [{ role: "developer", content: "Be brief." }, { role: "user", content: tag("developer") }] })).output_text).toBe(TEXT)
    },
    "stream-usage": async (target) => {
      const stream = await openai(target).responses.create({ model: MODEL, input: tag("stream-usage"), stream: true })
      let usage: OpenAI.Responses.ResponseUsage | undefined
      for await (const event of stream) if (event.type === "response.completed") usage = event.response.usage
      expect(usage).toMatchObject({ input_tokens: USAGE.inputTokens, output_tokens: USAGE.outputTokens })
    },
    "model-id": async (target) => {
      expect((await openai(target).responses.create({ model: CATALOG_ID, input: tag("model-id") })).output_text).toBe(TEXT)
    },
    cancel: async (target) => {
      const controller = new AbortController()
      const stream = await openai(target).responses.create({ model: MODEL, input: tag("cancel"), stream: true }, { signal: controller.signal })
      for await (const event of stream)
        if (event.type === "response.output_text.delta") {
          controller.abort()
          break
        }
      await serverSawAbort(target)
    },
  },
  na: {
    thinking: NA_RESPONSES_THINKING,
    n: "the Responses API has no n",
    "stop-sequence": NA_RESPONSES_STOP,
    "echo-suffix": NA_LEGACY,
    "count-tokens": NA_NO_COUNT,
    "prompt-array": "a prompt array is a legacy completions field",
    logprobs: NA_NO_LOGPROBS,
  },
}

const openaiCompletions: Client = {
  name: "openai",
  endpoint: "completions",
  cases: {
    text: async (target) => {
      expect((await openai(target).completions.create({ model: MODEL, prompt: tag("text") })).choices[0]!.text).toBe(TEXT)
    },
    stream: async (target) => {
      let text = ""
      for await (const chunk of await openai(target).completions.create({ model: MODEL, prompt: tag("stream"), stream: true })) text += chunk.choices[0]?.text ?? ""
      expect(text).toBe(STREAM_DELTAS.join(""))
    },
    error: (target) => expect429(() => openai(target).completions.create({ model: MODEL, prompt: tag("error") }), OpenAI.APIError),
    usage: async (target) => {
      expect((await openai(target).completions.create({ model: MODEL, prompt: tag("usage") })).usage).toMatchObject({ prompt_tokens: USAGE.inputTokens, completion_tokens: USAGE.outputTokens })
    },
    n: async (target) => {
      const completion = await openai(target).completions.create({ model: MODEL, prompt: tag("n"), n: 2 })
      expect(completion.choices.map((choice) => [choice.index, choice.text])).toEqual([
        [0, TEXT],
        [1, TEXT],
      ])
      // Usage is summed over the choices: each one is a full model call.
      expect(completion.usage).toMatchObject({ prompt_tokens: 2 * USAGE.inputTokens, completion_tokens: 2 * USAGE.outputTokens, total_tokens: 2 * (USAGE.inputTokens + USAGE.outputTokens) })
      // Streamed: each choice's chunks carry its own index, and the usage chunk has no choices and the sum.
      const stream = await openai(target).completions.create({ model: MODEL, prompt: tag("n"), n: 2, stream: true, stream_options: { include_usage: true } })
      const text: Record<number, string> = {}
      const chunks: OpenAI.Completions.Completion[] = []
      for await (const chunk of stream) {
        chunks.push(chunk)
        for (const choice of chunk.choices) text[choice.index] = (text[choice.index] ?? "") + choice.text
      }
      expect([text[0], text[1]]).toEqual([TEXT, TEXT])
      const last = chunks.at(-1)!
      expect(last.choices).toEqual([])
      expect(last.usage).toMatchObject({ prompt_tokens: 2 * USAGE.inputTokens, completion_tokens: 2 * USAGE.outputTokens })
      // A prompt array times n (#106): two prompts with n 2 make four choices, and each is a full call, so usage is summed over four.
      const batch = await openai(target).completions.create({ model: MODEL, prompt: [tag("n"), `${tag("n")} again`], n: 2 })
      expect(batch.choices.map((choice) => [choice.index, choice.text])).toEqual([
        [0, TEXT],
        [1, TEXT],
        [2, TEXT],
        [3, TEXT],
      ])
      expect(batch.usage).toMatchObject({ prompt_tokens: 4 * USAGE.inputTokens, completion_tokens: 4 * USAGE.outputTokens })
      const batchStream = await openai(target).completions.create({ model: MODEL, prompt: [tag("n"), `${tag("n")} again`], n: 2, stream: true })
      const indexes = new Set<number>()
      for await (const chunk of batchStream) for (const choice of chunk.choices) indexes.add(choice.index)
      expect([...indexes].sort()).toEqual([0, 1, 2, 3])
    },
    "stream-usage": async (target) => {
      const stream = await openai(target).completions.create({ model: MODEL, prompt: tag("stream-usage"), stream: true, stream_options: { include_usage: true } })
      let usage: OpenAI.CompletionUsage | null | undefined
      for await (const chunk of stream) usage = chunk.usage ?? usage
      expect(usage).toMatchObject({ prompt_tokens: USAGE.inputTokens, completion_tokens: USAGE.outputTokens })
    },
    // The echoed prompt comes first, then the completion. `suffix` alone is an instruction to the model, not an output.
    "echo-suffix": async (target) => {
      const echoed = await openai(target).completions.create({ model: MODEL, prompt: tag("echo-suffix"), echo: true, suffix: " world" })
      expect(echoed.choices[0]!.text).toBe(tag("echo-suffix") + TEXT)
      const suffixed = await openai(target).completions.create({ model: MODEL, prompt: tag("echo-suffix"), suffix: " world" })
      expect(suffixed.choices[0]!.text).toBe(TEXT)
    },
    "prompt-array": async (target) => {
      const completion = await openai(target).completions.create({ model: MODEL, prompt: [tag("prompt-array"), `${tag("prompt-array")} again`] })
      expect(completion.choices.map((choice) => [choice.index, choice.text])).toEqual([
        [0, TEXT],
        [1, TEXT],
      ])
    },
    "model-id": async (target) => {
      expect((await openai(target).completions.create({ model: CATALOG_ID, prompt: tag("model-id") })).choices[0]!.text).toBe(TEXT)
    },
    "stop-sequence": async (target) => {
      expect((await openai(target).completions.create({ model: MODEL, prompt: tag("stop-sequence"), stop: ["END"] })).choices[0]!.text).toBe(TEXT)
    },
    logprobs: async (target) => {
      expect((await openai(target).completions.create({ model: MODEL, prompt: tag("logprobs") })).choices[0]!.logprobs ?? null).toBeNull()
      const error = await openai(target)
        .completions.create({ model: MODEL, prompt: tag("logprobs"), logprobs: 5 })
        .then(
          () => undefined,
          (caught: unknown) => caught,
        )
      expect(error).toBeInstanceOf(OpenAI.BadRequestError)
    },
    cancel: async (target) => {
      const controller = new AbortController()
      const stream = await openai(target).completions.create({ model: MODEL, prompt: tag("cancel"), stream: true }, { signal: controller.signal })
      for await (const chunk of stream)
        if (chunk.choices[0]?.text) {
          controller.abort()
          break
        }
      await serverSawAbort(target)
    },
  },
  na: {
    tools: "legacy completions take a prompt, no tools",
    "parallel-tools": "legacy completions take a prompt, no tools",
    image: "legacy completions take text only",
    structured: "legacy completions have no response_format",
    "multi-turn": "legacy completions take one prompt, not a conversation",
    thinking: "legacy completions return no reasoning",
    developer: "legacy completions take a prompt, no messages",
    "count-tokens": NA_NO_COUNT,
    document: "legacy completions take text only",
  },
}

// ---------------------------------------------------------------- @anthropic-ai/sdk

const anthropic = ({ origin, apiKey }: Target) => new Anthropic({ baseURL: origin, apiKey, maxRetries: 0 })
const anthropicTool: Anthropic.Tool = { name: "weather", description: "Weather in a city", input_schema: WEATHER_SCHEMA }

const anthropicMessages: Client = {
  name: "@anthropic-ai/sdk",
  endpoint: "messages",
  cases: {
    text: async (target) => {
      const message = await anthropic(target).messages.create({ model: MODEL, max_tokens: 100, messages: [{ role: "user", content: tag("text") }] })
      expect(message.content as unknown).toEqual([{ type: "text", text: TEXT }])
    },
    stream: async (target) => {
      const stream = anthropic(target).messages.stream({ model: MODEL, max_tokens: 100, messages: [{ role: "user", content: tag("stream") }] })
      expect(await stream.finalText()).toBe(STREAM_DELTAS.join(""))
    },
    tools: async (target) => {
      const messages: Anthropic.MessageParam[] = [{ role: "user", content: tag("tools") }]
      const first = await anthropic(target).messages.create({ model: MODEL, max_tokens: 100, messages, tools: [anthropicTool] })
      expect(first.stop_reason).toBe("tool_use")
      const use = first.content.find((block) => block.type === "tool_use")!
      expect(use.input).toEqual({ city: "Oslo" })
      messages.push({ role: "assistant", content: first.content }, { role: "user", content: [{ type: "tool_result", tool_use_id: use.id, content: "sunny" }] })
      const second = await anthropic(target).messages.create({ model: MODEL, max_tokens: 100, messages, tools: [anthropicTool] })
      expect(second.content as unknown).toEqual([{ type: "text", text: TOOL_ANSWER }])
    },
    "parallel-tools": async (target) => {
      const messages: Anthropic.MessageParam[] = [{ role: "user", content: tag("parallel-tools") }]
      const first = await anthropic(target).messages.create({ model: MODEL, max_tokens: 100, messages, tools: [anthropicTool] })
      const uses = first.content.filter((block) => block.type === "tool_use")
      expect(uses).toHaveLength(2)
      messages.push({ role: "assistant", content: first.content }, { role: "user", content: uses.map((use) => ({ type: "tool_result" as const, tool_use_id: use.id, content: "ok" })) })
      expect((await anthropic(target).messages.create({ model: MODEL, max_tokens: 100, messages, tools: [anthropicTool] })).content as unknown).toEqual([{ type: "text", text: PARALLEL_ANSWER }])
    },
    image: async (target) => {
      const message = await anthropic(target).messages.create({
        model: MODEL,
        max_tokens: 100,
        messages: [{ role: "user", content: [{ type: "text", text: tag("image") }, { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_BASE64 } }] }],
      })
      expect(message.content as unknown).toEqual([{ type: "text", text: "image: image/png" }])
    },
    structured: {
      gap: "output_config.format (structured outputs) is refused with a 400; plugboard maps json_schema only on the OpenAI and Gemini endpoints",
      run: async (target) => {
        const message = await anthropic(target).messages.create({
          model: MODEL,
          max_tokens: 100,
          messages: [{ role: "user", content: tag("structured") }],
          output_config: { format: { type: "json_schema", schema: STRUCTURED_SCHEMA } },
        })
        const block = message.content[0]
        expect(JSON.parse(block?.type === "text" ? block.text : "")).toEqual(STRUCTURED)
      },
    },
    error: (target) => expect429(() => anthropic(target).messages.create({ model: MODEL, max_tokens: 100, messages: [{ role: "user", content: tag("error") }] }), Anthropic.APIError),
    usage: async (target) => {
      const { usage } = await anthropic(target).messages.create({ model: MODEL, max_tokens: 100, messages: [{ role: "user", content: tag("usage") }] })
      expect(usage).toMatchObject({ input_tokens: USAGE.inputTokens, output_tokens: USAGE.outputTokens })
    },
    "multi-turn": async (target) => {
      const message = await anthropic(target).messages.create({
        model: MODEL,
        max_tokens: 100,
        messages: [{ role: "user", content: tag("multi-turn") }, { role: "assistant", content: TEXT }, { role: "user", content: "Again?" }],
      })
      expect(message.content as unknown).toEqual([{ type: "text", text: MULTI_TURN_ANSWER }])
    },
    thinking: async (target) => {
      const message = await anthropic(target).messages.create({
        model: MODEL,
        max_tokens: 2000,
        thinking: { type: "enabled", budget_tokens: 1024 },
        messages: [{ role: "user", content: tag("thinking") }],
      })
      // plugboard sends an empty signature (src/anthropic/response.ts, #146); the SDK only needs a string, so the case accepts any.
      expect(message.content as unknown).toEqual([
        { type: "thinking", thinking: THINKING, signature: expect.any(String) },
        { type: "text", text: TEXT },
      ])
    },
    // The model's answer ends with the sequence; plugboard removes it and reports it (#145).
    "stop-sequence": async (target) => {
      const message = await anthropic(target).messages.create({ model: MODEL, max_tokens: 100, stop_sequences: ["END"], messages: [{ role: "user", content: tag("stop-sequence") }] })
      expect(message.stop_reason).toBe("stop_sequence")
      expect(message.stop_sequence).toBe("END")
      expect(message.content as unknown).toEqual([{ type: "text", text: TEXT }])
    },
    // An estimate (src/anthropic/tokens.ts): the case checks it is a positive count, not its value (#143).
    "count-tokens": async (target) => {
      expect((await anthropic(target).messages.countTokens({ model: MODEL, messages: [{ role: "user", content: tag("count-tokens") }] })).input_tokens).toBeGreaterThan(0)
    },
    document: async (target) => {
      const message = await anthropic(target).messages.create({
        model: MODEL,
        max_tokens: 100,
        messages: [{ role: "user", content: [{ type: "text", text: tag("document") }, { type: "document", source: { type: "base64", media_type: "application/pdf", data: PDF_BASE64 } }] }],
      })
      expect(message.content as unknown).toEqual([{ type: "text", text: "document: application/pdf" }])
    },
    "model-id": async (target) => {
      expect((await anthropic(target).messages.create({ model: CATALOG_ID, max_tokens: 100, messages: [{ role: "user", content: tag("model-id") }] })).content as unknown).toEqual([{ type: "text", text: TEXT }])
    },
    "stream-usage": async (target) => {
      const stream = anthropic(target).messages.stream({ model: MODEL, max_tokens: 100, messages: [{ role: "user", content: tag("stream-usage") }] })
      const message = await stream.finalMessage()
      expect(message.usage).toMatchObject({ input_tokens: USAGE.inputTokens, output_tokens: USAGE.outputTokens })
    },
    cancel: async (target) => {
      const controller = new AbortController()
      const stream = anthropic(target).messages.stream({ model: MODEL, max_tokens: 100, messages: [{ role: "user", content: tag("cancel") }] }, { signal: controller.signal })
      stream.on("text", () => controller.abort())
      await stream.done().catch(() => undefined)
      await serverSawAbort(target)
    },
  },
  na: {
    n: "Anthropic has no n: one answer per request",
    developer: "Anthropic has no developer role; system prompts go in the system field",
    "echo-suffix": NA_LEGACY,
    "prompt-array": "a prompt array is a legacy completions field",
    logprobs: "Anthropic has no logprobs option",
  },
}

// ---------------------------------------------------------------- @google/genai

const genai = ({ origin, apiKey }: Target) => new GoogleGenAI({ apiKey, httpOptions: { baseUrl: origin } })
const geminiTools = [{ functionDeclarations: [{ name: "weather", description: "Weather in a city", parametersJsonSchema: WEATHER_SCHEMA }] }]

/** First turn, the model's calls, and a user turn answering each (`contents` for the second request). */
async function geminiRoundTrip(target: Target, scenario: Scenario, calls: number): Promise<string | undefined> {
  const contents: Content[] = [{ role: "user", parts: [{ text: tag(scenario) }] }]
  const first = await genai(target).models.generateContent({ model: MODEL, contents, config: { tools: geminiTools } })
  expect(first.functionCalls).toHaveLength(calls)
  expect(first.functionCalls![0]!.args).toEqual({ city: "Oslo" })
  contents.push(first.candidates![0]!.content!, { role: "user", parts: first.functionCalls!.map((call) => ({ functionResponse: { name: call.name!, response: { output: "sunny" } } })) })
  return (await genai(target).models.generateContent({ model: MODEL, contents, config: { tools: geminiTools } })).text
}

const genaiGemini: Client = {
  name: "@google/genai",
  endpoint: "gemini",
  cases: {
    text: async (target) => {
      expect((await genai(target).models.generateContent({ model: MODEL, contents: tag("text") })).text).toBe(TEXT)
    },
    stream: async (target) => {
      let text = ""
      for await (const chunk of await genai(target).models.generateContentStream({ model: MODEL, contents: tag("stream") })) text += chunk.text ?? ""
      expect(text).toBe(STREAM_DELTAS.join(""))
    },
    tools: async (target) => expect(await geminiRoundTrip(target, "tools", 1)).toBe(TOOL_ANSWER),
    "parallel-tools": async (target) => expect(await geminiRoundTrip(target, "parallel-tools", 2)).toBe(PARALLEL_ANSWER),
    image: async (target) => {
      const response = await genai(target).models.generateContent({ model: MODEL, contents: [{ role: "user", parts: [{ text: tag("image") }, { inlineData: { mimeType: "image/png", data: PNG_BASE64 } }] }] })
      expect(response.text).toBe("image: image/png")
    },
    document: async (target) => {
      const response = await genai(target).models.generateContent({ model: MODEL, contents: [{ role: "user", parts: [{ text: tag("document") }, { inlineData: { mimeType: "application/pdf", data: PDF_BASE64 } }] }] })
      expect(response.text).toBe("document: application/pdf")
    },
    structured: async (target) => {
      const response = await genai(target).models.generateContent({ model: MODEL, contents: tag("structured"), config: { responseMimeType: "application/json", responseJsonSchema: STRUCTURED_SCHEMA } })
      expect(JSON.parse(response.text!)).toEqual(STRUCTURED)
    },
    error: async (target) => {
      const error = await genai(target)
        .models.generateContent({ model: MODEL, contents: tag("error") })
        .then(
          () => undefined,
          (caught: unknown) => caught,
        )
      expect((error as { status?: number }).status).toBe(429)
    },
    usage: async (target) => {
      const { usageMetadata } = await genai(target).models.generateContent({ model: MODEL, contents: tag("usage") })
      expect(usageMetadata).toMatchObject({ promptTokenCount: USAGE.inputTokens, totalTokenCount: USAGE.inputTokens + USAGE.outputTokens })
    },
    "multi-turn": async (target) => {
      const response = await genai(target).models.generateContent({
        model: MODEL,
        contents: [
          { role: "user", parts: [{ text: tag("multi-turn") }] },
          { role: "model", parts: [{ text: TEXT }] },
          { role: "user", parts: [{ text: "Again?" }] },
        ],
      })
      expect(response.text).toBe(MULTI_TURN_ANSWER)
    },
    "model-id": async (target) => {
      expect((await genai(target).models.generateContent({ model: CATALOG_ID, contents: tag("model-id") })).text).toBe(TEXT)
    },
    // A candidate count above 1 is refused (src/gemini/request.ts): the scenario is a gap until plugboard serves several candidates.
    n: {
      gap: "candidateCount above 1 is refused with a 400 (only one candidate is served); the OpenAI endpoints serve n",
      run: async (target) => {
        const response = await genai(target).models.generateContent({ model: MODEL, contents: tag("n"), config: { candidateCount: 2 } })
        expect(response.candidates).toHaveLength(2)
      },
    },
    "stop-sequence": async (target) => {
      const response = await genai(target).models.generateContent({ model: MODEL, contents: tag("stop-sequence"), config: { stopSequences: ["END"] } })
      expect(response.text).toBe(TEXT)
    },
    "stream-usage": async (target) => {
      let usage: { totalTokenCount?: number } | undefined
      for await (const chunk of await genai(target).models.generateContentStream({ model: MODEL, contents: tag("stream-usage") })) usage = chunk.usageMetadata ?? usage
      expect(usage).toMatchObject({ promptTokenCount: USAGE.inputTokens, totalTokenCount: USAGE.inputTokens + USAGE.outputTokens })
    },
    // An estimate (src/anthropic/tokens.ts), for the Gemini countTokens route (#144).
    "count-tokens": async (target) => {
      expect((await genai(target).models.countTokens({ model: MODEL, contents: tag("count-tokens") })).totalTokens).toBeGreaterThan(0)
    },
    cancel: async (target) => {
      const controller = new AbortController()
      for await (const chunk of await genai(target).models.generateContentStream({ model: MODEL, contents: tag("cancel"), config: { abortSignal: controller.signal } })) {
        if (chunk.text) {
          controller.abort()
          break
        }
      }
      await serverSawAbort(target)
    },
  },
  na: {
    thinking: "Gemini thought parts are dropped by plugboard (no thought output)",
    developer: "Gemini has no developer role; system prompts go in systemInstruction",
    "echo-suffix": NA_LEGACY,
    "prompt-array": "a prompt array is a legacy completions field",
    logprobs: "Gemini logprobs are not served by plugboard and are not part of this matrix",
  },
}

// ---------------------------------------------------------------- AI SDK

/** Provider options the AI SDK takes on each call (e.g. `{ openai: { store: false } }`). */
type ProviderOptions = NonNullable<Parameters<typeof generateText>[0]["providerOptions"]>

interface AiOptions {
  /** Known incompatibilities, by scenario, with the reason. */
  readonly gaps?: Partial<Record<Scenario, string>>
  /** Provider options on every call (e.g. `{ openai: { store: false } }`). */
  readonly providerOptions?: ProviderOptions
  /** Cases beyond the shared set, for what only this provider does (documents, thinking). */
  readonly extra?: Partial<Record<Scenario, Run>>
  /** Scenarios that do not apply to this provider, with the reason. Merged over the defaults. */
  readonly na?: Partial<Record<Scenario, string>>
}

const AI_NA: Partial<Record<Scenario, string>> = {
  developer: "the AI SDK sends system messages, not the developer role",
  "echo-suffix": NA_LEGACY,
  n: "generateText has no n option",
  "count-tokens": "the AI SDK does not call a token-count endpoint",
  "prompt-array": "a prompt array is a legacy completions field",
  logprobs: "the AI SDK does not request logprobs by default",
  thinking: "the AI SDK's default calls do not request reasoning",
}

/**
 * The same AI SDK calls against any provider's model: the AI SDK runs the tool loop itself. `model`
 * takes the model id, so the model-id scenario can send a catalog id.
 */
function aiSdk(name: string, endpoint: Endpoint, model: (target: Target, id?: string) => LanguageModel, options: AiOptions = {}): Client {
  const weather = tool({ description: "Weather in a city", inputSchema: jsonSchema<{ city: string }>(WEATHER_SCHEMA), execute: async ({ city }) => `sunny in ${city}` })
  const common = { maxRetries: 0, providerOptions: options.providerOptions }
  const cases: Partial<Record<Scenario, Run>> = {
    text: async (target) => {
      expect((await generateText({ model: model(target), prompt: tag("text"), ...common })).text).toBe(TEXT)
    },
    stream: async (target) => {
      const result = streamText({ model: model(target), prompt: tag("stream"), ...common, onError: () => {} })
      expect(await result.text).toBe(STREAM_DELTAS.join(""))
    },
    tools: async (target) => {
      const result = await generateText({ model: model(target), prompt: tag("tools"), tools: { weather }, stopWhen: stepCountIs(3), ...common })
      expect(result.steps[0]!.toolCalls.map((call) => call.input)).toEqual([{ city: "Oslo" }])
      expect(result.text).toBe(TOOL_ANSWER)
    },
    "parallel-tools": async (target) => {
      const result = await generateText({ model: model(target), prompt: tag("parallel-tools"), tools: { weather }, stopWhen: stepCountIs(3), ...common })
      expect(result.steps[0]!.toolCalls).toHaveLength(2)
      expect(result.text).toBe(PARALLEL_ANSWER)
    },
    image: async (target) => {
      const result = await generateText({ model: model(target), ...common, messages: [{ role: "user", content: [{ type: "text", text: tag("image") }, { type: "image", image: png(), mediaType: "image/png" }] }] })
      expect(result.text).toBe("image: image/png")
    },
    structured: async (target) => {
      const result = await generateText({ model: model(target), prompt: tag("structured"), output: Output.object({ schema: jsonSchema<typeof STRUCTURED>(STRUCTURED_SCHEMA) }), ...common })
      expect(result.output).toEqual(STRUCTURED)
    },
    error: async (target) => {
      const error = await generateText({ model: model(target), prompt: tag("error"), ...common }).then(
        () => undefined,
        (caught: unknown) => caught,
      )
      expect(APICallError.isInstance(error)).toBe(true)
      expect((error as APICallError).statusCode).toBe(429)
    },
    usage: async (target) => {
      const { usage } = await generateText({ model: model(target), prompt: tag("usage"), ...common })
      expect(usage).toMatchObject({ inputTokens: USAGE.inputTokens, outputTokens: USAGE.outputTokens })
    },
    // The AI SDK keeps the first turn's assistant message (with the provider's item id) and resends it.
    "multi-turn": async (target) => {
      const first = await generateText({ model: model(target), messages: [{ role: "user", content: tag("multi-turn") }], ...common })
      const second = await generateText({
        model: model(target),
        messages: [{ role: "user", content: tag("multi-turn") }, ...first.response.messages, { role: "user", content: "Again?" }],
        ...common,
      })
      expect(second.text).toBe(MULTI_TURN_ANSWER)
    },
    "stream-usage": async (target) => {
      const result = streamText({ model: model(target), prompt: tag("stream-usage"), ...common, onError: () => {} })
      await result.text
      expect(await result.usage).toMatchObject({ inputTokens: USAGE.inputTokens, outputTokens: USAGE.outputTokens })
    },
    "model-id": async (target) => {
      expect((await generateText({ model: model(target, CATALOG_ID), prompt: tag("model-id"), ...common })).text).toBe(TEXT)
    },
    "stop-sequence": async (target) => {
      const result = await generateText({ model: model(target), prompt: tag("stop-sequence"), stopSequences: ["END"], ...common })
      expect(result.text).toBe(TEXT)
    },
    cancel: async (target) => {
      const controller = new AbortController()
      const result = streamText({ model: model(target), prompt: tag("cancel"), abortSignal: controller.signal, ...common, onError: () => {} })
      for await (const text of result.textStream) {
        if (text) {
          controller.abort()
          break
        }
      }
      await serverSawAbort(target)
    },
  }
  // A scenario the provider refuses is n/a: its case is not run at all.
  for (const scenario of Object.keys(options.na ?? {})) delete cases[scenario as Scenario]
  const withGaps = Object.fromEntries(Object.entries(cases).map(([scenario, run]) => [scenario, options.gaps?.[scenario as Scenario] ? { gap: options.gaps[scenario as Scenario]!, run } : run]))
  const all = { ...withGaps, ...options.extra }
  // A scenario with a case is never n/a: the extra cases win over the defaults.
  const na = Object.fromEntries(Object.entries({ ...AI_NA, ...options.na }).filter(([scenario]) => !(scenario in all)))
  return { name, endpoint, cases: all as Client["cases"], na }
}

/** A PDF as a file part: the provider's document or file block (the AI SDK maps it per provider). */
const pdfRun =
  (model: (target: Target) => LanguageModel): Run =>
  async (target) => {
    const result = await generateText({
      model: model(target),
      maxRetries: 0,
      messages: [{ role: "user", content: [{ type: "text", text: tag("document") }, { type: "file", data: PDF_BASE64, mediaType: "application/pdf" }] }],
    })
    expect(result.text).toBe("document: application/pdf")
  }

const aiOpenAI = ({ origin, apiKey }: Target) => createOpenAI({ baseURL: `${origin}/v1`, apiKey })
const aiAnthropic = ({ origin, apiKey }: Target, id = MODEL) => createAnthropic({ baseURL: `${origin}/v1`, apiKey })(id)
const aiGoogle = ({ origin, apiKey }: Target, id = MODEL) => createGoogle({ baseURL: `${origin}/v1beta`, apiKey })(id)
const aiCompatible = ({ origin, apiKey }: Target, id = MODEL) => createOpenAICompatible({ name: "plugboard", baseURL: `${origin}/v1`, apiKey, includeUsage: true }).chatModel(id)

const aiChat = aiSdk("ai + @ai-sdk/openai (chat)", "chat", (target, id) => aiOpenAI(target).chat(id ?? MODEL), {
  extra: { document: pdfRun((target) => aiOpenAI(target).chat(MODEL)) },
})

const aiResponses = aiSdk("ai + @ai-sdk/openai (responses)", "responses", (target, id) => aiOpenAI(target).responses(id ?? MODEL), {
  na: { "stop-sequence": NA_RESPONSES_STOP, thinking: NA_RESPONSES_THINKING, logprobs: NA_NO_LOGPROBS },
  extra: { document: pdfRun((target) => aiOpenAI(target).responses(MODEL)) },
})

const aiResponsesStoreFalse = aiSdk("ai + @ai-sdk/openai (responses, store: false)", "responses", (target, id) => aiOpenAI(target).responses(id ?? MODEL), {
  providerOptions: { openai: { store: false } },
  na: { "stop-sequence": NA_RESPONSES_STOP, thinking: NA_RESPONSES_THINKING, logprobs: NA_NO_LOGPROBS },
  extra: { document: pdfRun((target) => aiOpenAI(target).responses(MODEL)) },
})

const aiCompatibleClient = aiSdk("ai + @ai-sdk/openai-compatible", "chat", (target, id) => aiCompatible(target, id), {
  na: { document: "openai-compatible sends PDFs only through providers that take file parts; not written for plugboard" },
})

const aiAnthropicClient = aiSdk("ai + @ai-sdk/anthropic", "messages", (target, id) => aiAnthropic(target, id), {
  extra: {
    document: pdfRun((target) => aiAnthropic(target)),
    // Thinking through the provider option: the reasoning comes back as reasoning content, then the answer.
    thinking: async (target) => {
      const result = await generateText({
        model: aiAnthropic(target),
        maxRetries: 0,
        prompt: tag("thinking"),
        providerOptions: { anthropic: { thinking: { type: "enabled", budgetTokens: 1024 } } },
      })
      expect(result.reasoningText).toBe(THINKING)
      expect(result.text).toBe(TEXT)
    },
  },
  na: { n: "generateText has no n option" },
})

const aiGoogleClient = aiSdk("ai + @ai-sdk/google", "gemini", (target, id) => aiGoogle(target, id), {
  gaps: {
    // The AI SDK's getModelPath treats an id with a slash as a full resource name and drops the models/ prefix, so the request misses the route: a 404 that names the expected path (#150).
    "model-id": "the AI SDK sends an id with a slash without the models/ prefix (it treats a slash as a full resource name), so the request misses the Gemini route (404 naming the expected path, #150); the @google/genai rows pass",
  },
  extra: { document: pdfRun((target) => aiGoogle(target)) },
  na: { "count-tokens": "the AI SDK does not call countTokens" },
})

export const CLIENTS: ReadonlyArray<Client> = [
  openaiChat,
  openaiResponses,
  openaiCompletions,
  anthropicMessages,
  genaiGemini,
  aiChat,
  aiResponses,
  aiResponsesStoreFalse,
  aiCompatibleClient,
  aiAnthropicClient,
  aiGoogleClient,
  ...LANGCHAIN_CLIENTS,
]
