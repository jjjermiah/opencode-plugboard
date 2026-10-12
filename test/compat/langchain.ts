/**
 * The LangChain JS clients of the compatibility matrix (#102, #103, #104, #106): the provider
 * classes pointed at plugboard the way their docs show, and the legacy completions class. Each
 * runs the scenarios its class supports through LangChain's own message and tool types, so the
 * matrix shows what a LangChain app sees, not what the SDK underneath sends.
 */
import { ChatAnthropic } from "@langchain/anthropic"
import type { BaseChatModel } from "@langchain/core/language_models/chat_models"
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages"
import { ChatGoogleGenerativeAI } from "@langchain/google-genai"
import { ChatOpenAI, OpenAI as OpenAICompletions } from "@langchain/openai"
import { expect } from "bun:test"
import { serverSawAbort } from "./abort.js"
import type { Client, Endpoint, Run, Target } from "./clients.js"
import { CATALOG_ID, MULTI_TURN_ANSWER, PARALLEL_ANSWER, PNG_BASE64, STREAM_DELTAS, STRUCTURED, STRUCTURED_SCHEMA, TEXT, THINKING, TOOL_ANSWER, USAGE, WEATHER_SCHEMA, tag, type Scenario } from "./scenarios.js"

const MODEL = "fast"
const weatherTool = { type: "function" as const, function: { name: "weather", description: "Weather in a city", parameters: WEATHER_SCHEMA } }

/** The error LangChain rethrows: the provider SDK's error, with its HTTP status. */
async function rejection(call: () => Promise<unknown>): Promise<{ status?: number } | undefined> {
  return (await call().then(
    () => undefined,
    (caught: unknown) => caught,
  )) as { status?: number } | undefined
}

const NA_LC_COUNT = "LangChain counts tokens on the client (getNumTokens); it does not call a count endpoint"
const NA_LC_DEVELOPER = "LangChain sends a SystemMessage as the system role, not developer"
const NA_LC_LEGACY = "echo and suffix are legacy completions options"

export interface LangChainOptions {
  /** Known incompatibilities, by scenario, with the reason. */
  readonly gaps?: Partial<Record<Scenario, string>>
  /** Cases beyond the shared set: the class's own options (n, thinking). */
  readonly extra?: Partial<Record<Scenario, Run>>
  /** Scenarios that do not apply to this class, with the reason. */
  readonly na?: Partial<Record<Scenario, string>>
}

/**
 * A chat model class with the scenarios of any provider. `make` builds it against plugboard, with
 * the model id given (the model-id scenario sends a catalog id).
 */
function langchain(name: string, endpoint: Endpoint, make: (target: Target, id?: string) => BaseChatModel, options: LangChainOptions = {}): Client {
  const cases: Partial<Record<Scenario, Run>> = {
    text: async (target) => {
      expect((await make(target).invoke([new HumanMessage(tag("text"))])).text).toBe(TEXT)
    },
    stream: async (target) => {
      let text = ""
      for await (const chunk of await make(target).stream([new HumanMessage(tag("stream"))])) text += chunk.text
      expect(text).toBe(STREAM_DELTAS.join(""))
    },
    tools: async (target) => {
      const llm = make(target).bindTools!([weatherTool])
      const first = (await llm.invoke([new HumanMessage(tag("tools"))])) as AIMessage
      expect(first.tool_calls).toEqual([expect.objectContaining({ name: "weather", args: { city: "Oslo" } })])
      const second = await llm.invoke([new HumanMessage(tag("tools")), first, new ToolMessage({ tool_call_id: first.tool_calls![0]!.id!, content: "sunny" })])
      expect(second.text).toBe(TOOL_ANSWER)
    },
    "parallel-tools": async (target) => {
      const llm = make(target).bindTools!([weatherTool])
      const first = (await llm.invoke([new HumanMessage(tag("parallel-tools"))])) as AIMessage
      expect(first.tool_calls).toHaveLength(2)
      const answers = first.tool_calls!.map((call) => new ToolMessage({ tool_call_id: call.id!, content: "ok" }))
      expect((await llm.invoke([new HumanMessage(tag("parallel-tools")), first, ...answers])).text).toBe(PARALLEL_ANSWER)
    },
    image: async (target) => {
      const reply = await make(target).invoke([new HumanMessage({ content: [{ type: "text", text: tag("image") }, { type: "image_url", image_url: { url: `data:image/png;base64,${PNG_BASE64}` } }] })])
      expect(reply.text).toBe("image: image/png")
    },
    structured: async (target) => {
      expect(await make(target).withStructuredOutput!(STRUCTURED_SCHEMA).invoke([new HumanMessage(tag("structured"))])).toEqual(STRUCTURED)
    },
    error: async (target) => {
      expect((await rejection(() => make(target).invoke([new HumanMessage(tag("error"))])))?.status).toBe(429)
    },
    usage: async (target) => {
      const reply = (await make(target).invoke([new HumanMessage(tag("usage"))])) as AIMessage
      expect(reply.usage_metadata).toMatchObject({ input_tokens: USAGE.inputTokens, output_tokens: USAGE.outputTokens })
    },
    "multi-turn": async (target) => {
      const reply = await make(target).invoke([new HumanMessage(tag("multi-turn")), new AIMessage(TEXT), new HumanMessage("Again?")])
      expect(reply.text).toBe(MULTI_TURN_ANSWER)
    },
    "stream-usage": async (target) => {
      let usage: AIMessage["usage_metadata"]
      for await (const chunk of await make(target).stream([new HumanMessage(tag("stream-usage"))])) usage = (chunk as AIMessage).usage_metadata ?? usage
      expect(usage).toMatchObject({ input_tokens: USAGE.inputTokens, output_tokens: USAGE.outputTokens })
    },
    "model-id": async (target) => {
      expect((await make(target, CATALOG_ID).invoke([new HumanMessage(tag("model-id"))])).text).toBe(TEXT)
    },
    "stop-sequence": async (target) => {
      const reply = await make(target).invoke([new HumanMessage(tag("stop-sequence"))], { stop: ["END"] })
      expect(reply.text).toBe(TEXT)
    },
    cancel: async (target) => {
      const controller = new AbortController()
      try {
        for await (const chunk of await make(target).stream([new HumanMessage(tag("cancel"))], { signal: controller.signal })) {
          if (chunk.text) {
            controller.abort()
            break
          }
        }
      } catch (error) {
        // Some SDKs throw when the stream is closed by the abort; any other failure still fails the case.
        if (!controller.signal.aborted) throw error
      }
      await serverSawAbort(target)
    },
  }
  for (const [scenario, run] of Object.entries(options.extra ?? {})) cases[scenario as Scenario] = run
  // A scenario the class refuses is n/a: its case is not run at all.
  for (const scenario of Object.keys(options.na ?? {})) delete cases[scenario as Scenario]
  const all = Object.fromEntries(Object.entries(cases).map(([scenario, run]) => [scenario, options.gaps?.[scenario as Scenario] ? { gap: options.gaps[scenario as Scenario]!, run } : run]))
  const na: Partial<Record<Scenario, string>> = {
    "echo-suffix": NA_LC_LEGACY,
    "count-tokens": NA_LC_COUNT,
    developer: NA_LC_DEVELOPER,
    "prompt-array": "a prompt array is a legacy completions field",
    ...options.na,
  }
  for (const scenario of Object.keys(all)) delete na[scenario as Scenario]
  return { name, endpoint, cases: all as Client["cases"], na }
}

const openai = ({ origin, apiKey }: Target) => ({ model: MODEL, apiKey, maxRetries: 0, configuration: { baseURL: `${origin}/v1` } })

/** The legacy `OpenAI` LLM class: a prompt string in, a string out, on `/v1/completions`. */
const legacyCompletions: Client = {
  name: "@langchain/openai (completions)",
  endpoint: "completions",
  cases: {
    text: async (target) => {
      expect(await new OpenAICompletions(openai(target)).invoke(tag("text"))).toBe(TEXT)
    },
    stream: async (target) => {
      let text = ""
      for await (const chunk of await new OpenAICompletions(openai(target)).stream(tag("stream"))) text += chunk
      expect(text).toBe(STREAM_DELTAS.join(""))
    },
    error: async (target) => {
      expect((await rejection(() => new OpenAICompletions(openai(target)).invoke(tag("error"))))?.status).toBe(429)
    },
    usage: async (target) => {
      const result = await new OpenAICompletions(openai(target)).generate([tag("usage")])
      expect(result.llmOutput?.tokenUsage).toMatchObject({ promptTokens: USAGE.inputTokens, completionTokens: USAGE.outputTokens })
    },
    n: async (target) => {
      const result = await new OpenAICompletions({ ...openai(target), n: 2 }).generate([tag("n")])
      expect(result.generations[0]!.map((generation) => generation.text)).toEqual([TEXT, TEXT])
    },
    "prompt-array": async (target) => {
      const result = await new OpenAICompletions(openai(target)).generate([tag("prompt-array"), `${tag("prompt-array")} again`])
      expect(result.generations.map((generations) => generations[0]!.text)).toEqual([TEXT, TEXT])
    },
    "model-id": async (target) => {
      expect(await new OpenAICompletions({ ...openai(target), model: CATALOG_ID }).invoke(tag("model-id"))).toBe(TEXT)
    },
    "stop-sequence": {
      gap: "stop sequences are not removed from the answer on /v1/completions (only /v1/messages strips the matched sequence, #145)",
      run: async (target) => {
        expect(await new OpenAICompletions(openai(target)).invoke(tag("stop-sequence"), { stop: ["END"] })).toBe(TEXT)
      },
    },
    cancel: async (target) => {
      const controller = new AbortController()
      for await (const chunk of await new OpenAICompletions(openai(target)).stream(tag("cancel"), { signal: controller.signal })) {
        if (chunk) {
          controller.abort()
          break
        }
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
    "echo-suffix": NA_LC_LEGACY,
    "count-tokens": NA_LC_COUNT,
    document: "legacy completions take text only",
    "stream-usage": "the LLM class streams text only; usage comes from generate",
    logprobs: "the LLM class does not request logprobs",
  },
}

export const LANGCHAIN_CLIENTS: ReadonlyArray<Client> = [
  langchain("@langchain/openai (chat)", "chat", (target, id) => new ChatOpenAI({ ...openai(target), model: id ?? MODEL }), {
    gaps: { "stop-sequence": "the chat endpoint does not remove stop sequences from the answer (#145 covers /v1/messages)" },
    extra: {
      // The class's `logprobs` option: plugboard refuses it with a 400 (logprobs are not served); without it the answer parses.
      logprobs: async (target) => {
        expect((await rejection(() => new ChatOpenAI({ ...openai(target), logprobs: true }).invoke([new HumanMessage(tag("logprobs"))])))?.status).toBe(400)
        expect((await new ChatOpenAI(openai(target)).invoke([new HumanMessage(tag("logprobs"))])).text).toBe(TEXT)
      },
      // The class's `n` option: one request, several generations.
      n: async (target) => {
        const result = await new ChatOpenAI({ ...openai(target), n: 2 }).generate([[new HumanMessage(tag("n"))]])
        expect(result.generations[0]!.map((generation) => generation.text)).toEqual([TEXT, TEXT])
      },
    },
    na: { thinking: "Chat Completions has no thinking blocks", document: "LangChain converts file blocks per provider; the openai SDK rows cover the PDF wire" },
  }),
  langchain("@langchain/openai (responses)", "responses", (target, id) => new ChatOpenAI({ ...openai(target), model: id ?? MODEL, useResponsesApi: true }), {
    na: {
      n: "the Responses API has no n",
      "stop-sequence": "the Responses API has no stop parameter",
      thinking: "plugboard drops reasoning on /v1/responses",
      logprobs: "logprobs are not part of this matrix for Responses (plugboard refuses top_logprobs)",
      document: "LangChain converts file blocks per provider; the openai SDK rows cover the PDF wire",
    },
  }),
  langchain("@langchain/anthropic", "messages", ({ origin, apiKey }, id) => new ChatAnthropic({ model: id ?? MODEL, apiKey, anthropicApiUrl: origin, maxTokens: 100, maxRetries: 0 }), {
    // message_start carries input_tokens 0: the input count is only known when the model finishes (message_delta). LangChain sums the two, so its streamed usage has no input.
    gaps: { "stream-usage": "message_start reports input_tokens 0; the real input count arrives only in message_delta, so a client that reads usage from message_start sees 0" },
    extra: {
      // The class's `thinking` option: the reasoning comes back as a thinking block, then the answer.
      thinking: async ({ origin, apiKey }) => {
        const reply = await new ChatAnthropic({ model: MODEL, apiKey, anthropicApiUrl: origin, maxTokens: 2000, maxRetries: 0, thinking: { type: "enabled", budget_tokens: 1024 } }).invoke([
          new HumanMessage(tag("thinking")),
        ])
        const blocks = reply.content as Array<{ type: string; thinking?: string }>
        expect(blocks.find((block) => block.type === "thinking")?.thinking).toBe(THINKING)
        expect(reply.text).toBe(TEXT)
      },
    },
    na: {
      n: "Anthropic has no n: one answer per request",
      logprobs: "Anthropic has no logprobs option",
      document: "LangChain converts file blocks per provider; the Anthropic SDK rows cover the document wire",
    },
  }),
  langchain("@langchain/google-genai", "gemini", ({ origin, apiKey }, id) => new ChatGoogleGenerativeAI({ model: id ?? MODEL, apiKey, baseUrl: origin, apiVersion: "v1beta", maxRetries: 0 }), {
    gaps: {
      "stop-sequence": "stopSequences are not removed from the answer on the Gemini endpoint (only /v1/messages strips the matched sequence, #145)",
      "model-id": "LangChain's Google class sends the model id without the models/ prefix, so the request misses the Gemini route (401); the @google/genai rows pass",
      // The SDK LangChain uses (@google/generative-ai) reports the client's abort as an unhandled "Error reading from the stream".
      cancel: "the @google/generative-ai SDK that LangChain uses reports the client's abort as an unhandled 'Error reading from the stream'",
    },
    // The class has no n option, and the image case is refused client-side below.
    na: {
      n: "LangChain's Google class has no n option",
      image: "the class refuses inline images unless the model name looks multimodal; the matrix alias is `fast`",
      logprobs: "Gemini logprobs are not served by plugboard and are not part of this matrix",
      document: "LangChain converts file blocks per provider; the Gemini SDK rows cover the PDF wire",
      thinking: "Gemini thought parts are dropped by plugboard (no thought output)",
    },
  }),
  legacyCompletions,
]
