/**
 * The Vercel AI SDK's Anthropic provider, pointed at plugboard. Each scenario file takes the provider's model factory as
 * `client`, a function from a model id to a model. The provider's base URL ends in `/v1` (its default is
 * https://api.anthropic.com/v1) and it appends `/messages` itself.
 */
import { createAnthropic } from "@ai-sdk/anthropic"

// #region snippet
const baseURL = process.env.PLUGBOARD_BASE_URL! // ends in /v1
const apiKey = process.env.PLUGBOARD_KEY!

export const anthropic = createAnthropic({ baseURL, apiKey })
// #endregion snippet

/** The same base URL without the `/v1`, for the one scenario that calls GET /v1/models with fetch. */
export const plugboardURL = baseURL.replace(/\/v1$/, "")

export type Client = (id: string) => ReturnType<typeof anthropic>

export const client: Client = (id) => anthropic(id)

/** The SDK says `tool-calls`; the wire and the shared checks say `tool_calls` (as the other examples). */
export const wireFinish = (reason: string | null | undefined): string | null => reason?.replaceAll("-", "_") ?? null

export const plugboardKey = apiKey
export const plugboardV1 = baseURL
