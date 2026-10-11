/**
 * The neutral vocabulary between plugboard's layers.
 *
 * Front-ends (OpenAI Chat Completions now; others later) translate their wire format to and
 * from these types. A `ModelCaller` turns a `PlugRequest` into a stream of `PlugEvent`s. Names
 * mirror `@opencode/ai` (request parts, `LLMEvent`, `Usage`) so a native `ctx.llm.stream`
 * backend could replace the session backend without touching the front-ends.
 *
 * Nothing here is specific to a wire protocol: response-shaping choices (streaming, usage
 * chunks, structured-output unwrapping) belong to the front-end, not to the request.
 *
 * Types plus one discriminator (`isPlugError`).
 */

// ---------------------------------------------------------------- models

export interface ModelRef {
  readonly providerID: string
  readonly id: string
  readonly variant?: string
}

/**
 * One price entry, USD per million tokens (the host's `Model.Cost`). An entry with `aboveContext`
 * applies once the prompt context exceeds that many tokens; the entry without it is the base price.
 */
export interface CatalogCost {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly aboveContext?: number
}

/** One enabled model as the server sees it: what model listing and the request resolver work from. */
export interface CatalogModel {
  readonly providerID: string
  readonly id: string
  readonly name?: string
  readonly variants: ReadonlyArray<string>
  readonly capabilities?: { readonly tools?: boolean; readonly image?: boolean }
  readonly contextLimit?: number
  /** Token limits as the host reports them (`limit.{context,input,output}`). */
  readonly limits?: { readonly context?: number; readonly input?: number; readonly output?: number }
  /** Modalities the model accepts and produces (`capabilities.input` / `.output`, for example `text`, `image`). */
  readonly modalities?: { readonly input: ReadonlyArray<string>; readonly output: ReadonlyArray<string> }
  readonly cost?: ReadonlyArray<CatalogCost>
  readonly status?: "alpha" | "beta" | "deprecated" | "active"
  readonly family?: string
  /** Release date, epoch milliseconds. */
  readonly released?: number
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

/** Format-neutral model call. Front-ends produce it; the `ModelCaller` consumes it. */
export interface PlugRequest {
  /** The model string the caller sent (id or alias). Informational for the backend (session title, metadata). */
  readonly model: string
  /** Resolved by the core before reaching the `ModelCaller`. */
  readonly ref: ModelRef
  readonly system: ReadonlyArray<string>
  readonly messages: ReadonlyArray<PlugMessage>
  readonly tools: ReadonlyArray<PlugTool>
  readonly toolChoice?: PlugToolChoice
  readonly generation: PlugGeneration
}

// ---------------------------------------------------------------- events

/**
 * Token usage for one model call. Totals are inclusive, like OpenAI's:
 * `inputTokens` includes `cacheReadTokens` and `cacheWriteTokens`;
 * `outputTokens` includes `reasoningTokens`.
 */
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

export type PlugErrorKind = "invalid_request" | "authentication" | "permission" | "not_found" | "rate_limit" | "server" | "timeout"

/**
 * An error with an HTTP status and a transport-neutral kind. Front-ends map `kind` to their wire
 * vocabulary (OpenAI: `src/openai/response.ts`). `code` is a machine-readable detail and `param`
 * names the offending request field, when there is one.
 */
export interface PlugError {
  readonly status: number
  readonly kind: PlugErrorKind
  readonly message: string
  readonly code?: string
  readonly param?: string
  /** Seconds to wait before a retry, for a `Retry-After` header. Set by the limiter (`src/limits.ts`); no route reads it yet. */
  readonly retryAfterSeconds?: number
}

/** The one discriminator for `PlugError` values returned in place of a result. */
export const isPlugError = (value: unknown): value is PlugError =>
  typeof value === "object" && value !== null && "status" in value && "kind" in value && "message" in value

// ---------------------------------------------------------------- caller

/** What an app's policy (option `apps`) changed in a request in a way the caller should be told about. */
export type PolicyNote = "tools-stripped"

export interface CallContext {
  /** App name (key name, or the default app). Decides the history directory. */
  readonly app: string
  /** Aborted on client disconnect or timeout. */
  readonly signal: AbortSignal
  /** Called once, before the first event, with the id of the history record this call writes (if any). */
  readonly onRecord?: (recordID: string) => void
  /**
   * Called once, before the first event, only for a request whose model is an alias with fallbacks
   * (`src/fallback.ts`): which target answered and how many earlier targets failed first. A front-end
   * uses it for `x-plugboard-model` and the `model` it echoes. A call that fails on every target never
   * reports it.
   */
  readonly onServed?: (served: ServedModel) => void
  /** Called once, before the first event, with each change the app's policy made that the caller sent for. Front-ends report them in the `x-plugboard-policy` header. */
  readonly onPolicy?: (notes: ReadonlyArray<PolicyNote>) => void
  /** Called once, before the first event, when the response cache applies to the call: `hit` replays a stored answer (no session, no record), `miss` runs the model. Not called when the cache is off, skipped for the app, or `noCache` is set. */
  readonly onCache?: (result: "hit" | "miss") => void
  /** Bypass the response cache for this call. Fan-out sets it: each choice of `n` above 1 repeats one request and must be a fresh sample. */
  readonly noCache?: boolean
}

/** The target of an alias that answered: `provider/model[#variant]`, and the targets tried before it. */
export interface ServedModel {
  readonly model: string
  readonly fallbacks: number
}

/** The seam between the core and a backend (the session backend now, `ctx.llm.stream` possibly later). */
export interface ModelCaller {
  stream(request: PlugRequest, context: CallContext): AsyncIterable<PlugEvent>
}
