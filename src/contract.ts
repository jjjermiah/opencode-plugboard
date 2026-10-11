/**
 * Shared contracts between plugboard's layers (spec: homelab
 * .agents/specs/2026-10-11-opencode-openai-adapter-plugin.md, D2 and D6).
 *
 * Front-ends (OpenAI Chat Completions now; Responses, Anthropic Messages and Gemini later)
 * translate their wire format to and from these types. The ModelCaller turns a
 * PlugRequest into a stream of PlugEvents. Names mirror `@opencode/ai`
 * (LLMRequest parts, LLMEvent, Usage) so a native `ctx.llm.stream` backend can
 * replace the session backend without touching the front-ends.
 *
 * Type-only module: no runtime code, nothing imported at runtime.
 */

// ---------------------------------------------------------------- options

/** Plugin options, after defaults and validation (see config.ts). */
export interface PlugboardOptions {
  readonly listen: { readonly host: string; readonly port: number }
  /** App name -> API key. App names match APP_NAME_PATTERN; "default" is reserved. */
  readonly keys: Readonly<Record<string, string>>
  /** Allowlist: exact `provider/model`, `provider/model#variant`, or `provider/*` patterns. Empty = nothing allowed. */
  readonly models: ReadonlyArray<string>
  /** Alias -> `provider/model[#variant]`. Targets must also pass the allowlist. */
  readonly aliases: Readonly<Record<string, string>>
  readonly maxTools: number
  readonly requestTimeoutMs: number
}

export const APP_NAME_PATTERN = /^[a-z0-9-]+$/
export const DEFAULT_APP = "default"
export const DEFAULTS = {
  host: "127.0.0.1",
  port: 4010,
  maxTools: 32,
  requestTimeoutMs: 600_000,
} as const

// ---------------------------------------------------------------- models

export interface ModelRef {
  readonly providerID: string
  readonly id: string
  readonly variant?: string
}

/** What `/v1/models` and the request resolver work from: one enabled model as the server sees it. */
export interface CatalogModel {
  readonly providerID: string
  readonly id: string
  readonly name?: string
  readonly variants: ReadonlyArray<string>
  readonly capabilities?: { readonly tools?: boolean; readonly image?: boolean }
  readonly contextLimit?: number
}

// ---------------------------------------------------------------- request

export interface TextPart {
  readonly type: "text"
  readonly text: string
}
/** Image or file. `url` is a data: URL or http(s) URL; the backend turns it into a host media asset. */
export interface MediaPart {
  readonly type: "media"
  readonly url: string
  readonly mediaType?: string
}
export interface ToolCallPart {
  readonly type: "tool-call"
  readonly id: string
  readonly name: string
  readonly input: unknown
}
export interface ToolResultPart {
  readonly type: "tool-result"
  readonly id: string
  readonly name: string
  /** Text content as the caller sent it (JSON strings stay strings). */
  readonly result: string
  readonly isError?: boolean
}

export type PlugPart = TextPart | MediaPart | ToolCallPart | ToolResultPart

export interface PlugMessage {
  readonly role: "user" | "assistant" | "tool"
  readonly content: ReadonlyArray<PlugPart>
}

export interface PlugTool {
  readonly name: string
  readonly description: string
  /** JSON Schema object. */
  readonly parameters: Readonly<Record<string, unknown>>
}

export type PlugToolChoice = "auto" | "none" | "required" | { readonly type: "tool"; readonly name: string }

export interface PlugGeneration {
  readonly maxTokens?: number
  readonly temperature?: number
  readonly topP?: number
  readonly stop?: ReadonlyArray<string>
  readonly presencePenalty?: number
  readonly frequencyPenalty?: number
}

/** Format-neutral request. Front-ends produce it; the ModelCaller consumes it. */
export interface PlugRequest {
  /** Caller's model string as sent (id or alias), echoed back in responses. */
  readonly model: string
  /** Resolved by the core before reaching the ModelCaller. */
  readonly ref: ModelRef
  readonly system: ReadonlyArray<string>
  readonly messages: ReadonlyArray<PlugMessage>
  readonly tools: ReadonlyArray<PlugTool>
  readonly toolChoice?: PlugToolChoice
  readonly generation: PlugGeneration
  /** Set when the front-end mapped response_format to a forced tool (D13); the front-end unwraps it. */
  readonly structured?: { readonly toolName: string }
  readonly stream: boolean
}

// ---------------------------------------------------------------- events

export interface PlugUsage {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly reasoningTokens?: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
}

export type PlugFinish = "stop" | "length" | "tool-calls" | "content-filter" | "error"

export type PlugEvent =
  | { readonly type: "text-delta"; readonly text: string }
  | { readonly type: "reasoning-delta"; readonly text: string }
  | { readonly type: "tool-call"; readonly id: string; readonly name: string; readonly input: unknown }
  | { readonly type: "finish"; readonly reason: PlugFinish; readonly usage?: PlugUsage }
  | { readonly type: "error"; readonly error: PlugError }

/** Error with an HTTP status and an OpenAI-style type/code; front-ends encode it. */
export interface PlugError {
  readonly status: number
  readonly message: string
  readonly type: "invalid_request_error" | "authentication_error" | "permission_error" | "not_found_error" | "rate_limit_error" | "server_error" | "timeout_error"
  readonly code?: string
  readonly param?: string
}

// ---------------------------------------------------------------- caller

export interface CallContext {
  /** App name (key name, or DEFAULT_APP). Decides the history directory. */
  readonly app: string
  /** Aborted on client disconnect or timeout. */
  readonly signal: AbortSignal
}

/** D6: the seam between the core and a backend (session backend now, ctx.llm.stream later). */
export interface ModelCaller {
  stream(request: PlugRequest, context: CallContext): AsyncIterable<PlugEvent>
}
