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
import type { Client, Endpoint, Run, Target } from "./clients.js"
import { MULTI_TURN_ANSWER, PARALLEL_ANSWER, PNG_BASE64, STREAM_DELTAS, TEXT, TOOL_ANSWER, USAGE, WEATHER_SCHEMA, tag, type Scenario } from "./scenarios.js"

const MODEL = "fast"
const weatherTool = { type: "function" as const, function: { name: "weather", description: "Weather in a city", parameters: WEATHER_SCHEMA } }

/** The error LangChain rethrows: the provider SDK's error, with its HTTP status. */
async function rejection(call: () => Promise<unknown>): Promise<{ status?: number } | undefined> {
  return (await call().then(
    () => undefined,
    (caught: unknown) => caught,
  )) as { status?: number } | undefined
}

/**
 * A chat model class with the scenarios of any provider; `make` builds it against plugboard. `na`
 * leaves scenarios out (n/a) when the class refuses them before any request is sent.
 */
function langchain(name: string, endpoint: Endpoint, make: (target: Target) => BaseChatModel, gaps: Partial<Record<Scenario, string>> = {}, na: Scenario[] = []): Client {
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
  }
  for (const scenario of na) delete cases[scenario]
  const withGaps = Object.fromEntries(Object.entries(cases).map(([scenario, run]) => [scenario, gaps[scenario as Scenario] ? { gap: gaps[scenario as Scenario]!, run } : run]))
  return { name, endpoint, cases: withGaps as Client["cases"] }
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
  },
}

export const LANGCHAIN_CLIENTS: ReadonlyArray<Client> = [
  langchain("@langchain/openai (chat)", "chat", (target) => new ChatOpenAI(openai(target))),
  langchain("@langchain/openai (responses)", "responses", (target) => new ChatOpenAI({ ...openai(target), useResponsesApi: true })),
  langchain("@langchain/anthropic", "messages", ({ origin, apiKey }) => new ChatAnthropic({ model: MODEL, apiKey, anthropicApiUrl: origin, maxTokens: 100, maxRetries: 0 })),
  // The class refuses inline images unless the model name looks multimodal; the matrix's alias is `fast`, so image is n/a here.
  langchain("@langchain/google-genai", "gemini", ({ origin, apiKey }) => new ChatGoogleGenerativeAI({ model: MODEL, apiKey, baseUrl: origin, apiVersion: "v1beta", maxRetries: 0 }), {}, ["image"]),
  legacyCompletions,
]
