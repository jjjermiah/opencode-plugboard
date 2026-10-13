/**
 * The three ways into plugboard from the Vercel AI SDK. Each scenario file takes one of them as `client`, a function
 * from a model id to a model. The runner picks the way by variant; readers copy the constructions in the snippet.
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createOpenAI } from "@ai-sdk/openai"
import type { LanguageModel } from "ai"

// #region snippet
const baseURL = process.env.PLUGBOARD_BASE_URL! // ends in /v1
const apiKey = process.env.PLUGBOARD_KEY!

// 1. createOpenAICompatible: Chat Completions. supportsStructuredOutputs sends json_schema for Output.object (structured.ts).
export const compat = createOpenAICompatible({ name: "plugboard", baseURL, apiKey, includeUsage: true, supportsStructuredOutputs: true })

// 2. openai.chat(id): Chat Completions through @ai-sdk/openai.
// 3. openai(id): the default. In @ai-sdk/openai v4 it is the Responses API (POST /v1/responses).
export const openai = createOpenAI({ baseURL, apiKey })
// #endregion snippet

/** `compat` is createOpenAICompatible, `openai-chat` is openai.chat(id), `responses` is openai(id). */
export type Api = "compat" | "openai-chat" | "responses"
export type Client = (id: string) => LanguageModel

export const apis: Record<Api, Client> = {
  compat: (id) => compat.chatModel(id),
  "openai-chat": (id) => openai.chat(id),
  responses: (id) => openai(id),
}

/** The SDK says `tool-calls`; the wire and the shared checks say `tool_calls`. */
export const wireFinish = (reason: string | null | undefined): string | null => reason?.replaceAll("-", "_") ?? null

/** The base URL and app key, for the scenarios that build their own provider. */
export const plugboardURL = baseURL
export const plugboardKey = apiKey
