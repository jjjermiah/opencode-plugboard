/**
 * The Google provider from the Vercel AI SDK, pointed at plugboard's Gemini route. Scenario files take `client`, a function
 * from a plugboard model id to a model; the runner passes it through unchanged.
 */
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import type { LanguageModel } from "ai"

// #region snippet
// The provider adds /models/{id}:generateContent itself, so baseURL ends in /v1beta and not in /v1.
// It adds the models/ prefix only when the id has no /. An id with a / (anthropic/claude-haiku-4-5) would go out as
// /v1beta/anthropic/... and plugboard answers 404, so the id is percent-encoded: / as %2F, # as %23 (docs/gemini.md).
const origin = (process.env.PLUGBOARD_BASE_URL ?? "").replace(/\/v1\/?$/, "")
export const plugboardURL = `${origin}/v1beta`
export const plugboardKey = process.env.PLUGBOARD_KEY ?? ""
export const google = createGoogleGenerativeAI({ baseURL: plugboardURL, apiKey: plugboardKey })
// #endregion snippet

export type Client = (id: string) => LanguageModel
export const client: Client = (id) => google(encodeURIComponent(id))

/** The SDK says `tool-calls`; the wire and the shared checks say `tool_calls`. */
export const wireFinish = (reason: string | null | undefined): string | null => reason?.replaceAll("-", "_") ?? null
