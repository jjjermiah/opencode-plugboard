/**
 * The clients of the compatibility matrix (#101): each official SDK, run the way its docs show,
 * pointed at plugboard. A client lists the scenarios its endpoint supports; a scenario it leaves
 * out is "n/a" in the matrix (no tools on legacy completions), and one marked `gap` is a known
 * incompatibility that is expected to fail until fixed.
 *
 * SDK retries are off, so the error scenario fails fast instead of backing off.
 */
import Anthropic from "@anthropic-ai/sdk"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createGoogle } from "@ai-sdk/google"
import { createOpenAI } from "@ai-sdk/openai"
import { GoogleGenAI, type Content } from "@google/genai"
import { APICallError, generateText, jsonSchema, Output, stepCountIs, streamText, tool, type LanguageModel } from "ai"
import { expect } from "bun:test"
import OpenAI from "openai"
import { PARALLEL_ANSWER, PNG_BASE64, STREAM_DELTAS, STRUCTURED, STRUCTURED_SCHEMA, TEXT, TOOL_ANSWER, USAGE, WEATHER_SCHEMA, tag, type Scenario } from "./scenarios.js"

export const ENDPOINTS = {
  chat: "POST /v1/chat/completions",
  responses: "POST /v1/responses",
  completions: "POST /v1/completions",
  messages: "POST /v1/messages",
  gemini: "POST /v1beta/models/{model}:generateContent",
} as const
export type Endpoint = keyof typeof ENDPOINTS

/** Where plugboard listens and the key of the app the matrix runs as. */
export interface Target {
  readonly origin: string
  readonly apiKey: string
}

export type Run = (target: Target) => Promise<void>
export type Case = Run | { readonly gap: string; readonly run: Run }

export interface Client {
  /** Display name: the package as an app developer knows it. */
  readonly name: string
  readonly endpoint: Endpoint
  readonly cases: Partial<Record<Scenario, Case>>
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

// ---------------------------------------------------------------- openai

const openai = ({ origin, apiKey }: Target) => new OpenAI({ baseURL: `${origin}/v1`, apiKey, maxRetries: 0 })
const weatherTool: OpenAI.Chat.Completions.ChatCompletionTool = { type: "function", function: { name: "weather", description: "Weather in a city", parameters: WEATHER_SCHEMA } }

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
    structured: async (target) => {
      const response = await openai(target).responses.create({ model: MODEL, input: tag("structured"), text: { format: { type: "json_schema", name: "answer", schema: STRUCTURED_SCHEMA, strict: true } } })
      expect(JSON.parse(response.output_text)).toEqual(STRUCTURED)
    },
    error: (target) => expect429(() => openai(target).responses.create({ model: MODEL, input: tag("error") }), OpenAI.APIError),
    usage: async (target) => {
      expect((await openai(target).responses.create({ model: MODEL, input: tag("usage") })).usage).toMatchObject({ input_tokens: USAGE.inputTokens, output_tokens: USAGE.outputTokens })
    },
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
  },
}

// ---------------------------------------------------------------- AI SDK

/** The same AI SDK calls against any provider's model: the AI SDK runs the tool loop itself. */
function aiSdk(name: string, endpoint: Endpoint, model: (target: Target) => LanguageModel, gaps: Partial<Record<Scenario, string>> = {}): Client {
  const weather = tool({ description: "Weather in a city", inputSchema: jsonSchema<{ city: string }>(WEATHER_SCHEMA), execute: async ({ city }) => `sunny in ${city}` })
  const cases: Record<Scenario, Run> = {
    text: async (target) => {
      expect((await generateText({ model: model(target), prompt: tag("text"), maxRetries: 0 })).text).toBe(TEXT)
    },
    stream: async (target) => {
      const result = streamText({ model: model(target), prompt: tag("stream"), maxRetries: 0, onError: () => {} })
      expect(await result.text).toBe(STREAM_DELTAS.join(""))
    },
    tools: async (target) => {
      const result = await generateText({ model: model(target), prompt: tag("tools"), tools: { weather }, stopWhen: stepCountIs(3), maxRetries: 0 })
      expect(result.steps[0]!.toolCalls.map((call) => call.input)).toEqual([{ city: "Oslo" }])
      expect(result.text).toBe(TOOL_ANSWER)
    },
    "parallel-tools": async (target) => {
      const result = await generateText({ model: model(target), prompt: tag("parallel-tools"), tools: { weather }, stopWhen: stepCountIs(3), maxRetries: 0 })
      expect(result.steps[0]!.toolCalls).toHaveLength(2)
      expect(result.text).toBe(PARALLEL_ANSWER)
    },
    image: async (target) => {
      const result = await generateText({ model: model(target), maxRetries: 0, messages: [{ role: "user", content: [{ type: "text", text: tag("image") }, { type: "image", image: png(), mediaType: "image/png" }] }] })
      expect(result.text).toBe("image: image/png")
    },
    structured: async (target) => {
      const result = await generateText({ model: model(target), prompt: tag("structured"), output: Output.object({ schema: jsonSchema<typeof STRUCTURED>(STRUCTURED_SCHEMA) }), maxRetries: 0 })
      expect(result.output).toEqual(STRUCTURED)
    },
    error: async (target) => {
      const error = await generateText({ model: model(target), prompt: tag("error"), maxRetries: 0 }).then(
        () => undefined,
        (caught: unknown) => caught,
      )
      expect(APICallError.isInstance(error)).toBe(true)
      expect((error as APICallError).statusCode).toBe(429)
    },
    usage: async (target) => {
      const { usage } = await generateText({ model: model(target), prompt: tag("usage"), maxRetries: 0 })
      expect(usage).toMatchObject({ inputTokens: USAGE.inputTokens, outputTokens: USAGE.outputTokens })
    },
  }
  return { name, endpoint, cases: Object.fromEntries(Object.entries(cases).map(([scenario, run]) => [scenario, gaps[scenario as Scenario] ? { gap: gaps[scenario as Scenario]!, run } : run])) }
}

export const CLIENTS: ReadonlyArray<Client> = [
  openaiChat,
  openaiResponses,
  openaiCompletions,
  anthropicMessages,
  genaiGemini,
  aiSdk("ai + @ai-sdk/openai (chat)", "chat", ({ origin, apiKey }) => createOpenAI({ baseURL: `${origin}/v1`, apiKey }).chat(MODEL)),
  aiSdk("ai + @ai-sdk/openai (responses)", "responses", ({ origin, apiKey }) => createOpenAI({ baseURL: `${origin}/v1`, apiKey }).responses(MODEL)),
  aiSdk("ai + @ai-sdk/anthropic", "messages", ({ origin, apiKey }) => createAnthropic({ baseURL: `${origin}/v1`, apiKey })(MODEL)),
  aiSdk("ai + @ai-sdk/google", "gemini", ({ origin, apiKey }) => createGoogle({ baseURL: `${origin}/v1beta`, apiKey })(MODEL)),
]
