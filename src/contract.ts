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
  /** Cache prices when the host reports them; absent means unknown (not free). */
  readonly cacheRead?: number
  readonly cacheWrite?: number
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

/**
 * `cache`: the caller placed a cache breakpoint on this part (Anthropic `cache_control`). `cacheTtl` is `"1h"` when the caller
 * asked for the 1-hour TTL, else the default 5 minutes (#275). The 1h TTL is carried only when the request has no tools; see
 * `src/session/context.ts` (`orderOneHourHints`) and docs/messages.md.
 */
export interface TextPart {
  readonly type: "text"
  readonly text: string
  readonly cache?: boolean
  readonly cacheTtl?: "1h"
}
/** Image or file. `url` is a data: URL or http(s) URL; the backend turns it into a host media asset. */
export interface MediaPart {
  readonly type: "media"
  readonly url: string
  readonly mediaType?: string
  readonly cache?: boolean
  readonly cacheTtl?: "1h"
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
  /** A caller cache breakpoint on the result (see `TextPart.cache`). */
  readonly cache?: boolean
  readonly cacheTtl?: "1h"
}

/**
 * Replayable reasoning from a caller's history (#374): a signed `thinking` block (`signature`, with its `text`) or a
 * `redacted_thinking` block (`redactedData`, empty `text`). Unsigned thinking is not a part: the decoder drops it, as before.
 */
export interface ReasoningPart {
  readonly type: "reasoning"
  readonly text: string
  readonly signature?: string
  readonly redactedData?: string
}

export type PlugPart = TextPart | MediaPart | ToolCallPart | ToolResultPart | ReasoningPart

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
  /** Anthropic `top_k`, Gemini `topK`. Chat Completions and Responses have no such field. */
  readonly topK?: number
  /** Chat Completions and legacy completions `seed`, Gemini `seed`. */
  readonly seed?: number
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
  /** `false` when the caller asked for at most one tool call per answer (`parallel_tool_calls: false`, `disable_parallel_tool_use`). The host has no switch for it on every route, so the session collector keeps the first call and drops the rest (#202). */
  readonly parallelToolCalls?: boolean
  /**
   * The forced tool that carries a `json_schema` answer (`respond`), set by the front-end when the request asked for
   * structured output. The app's `tools: false` keeps only this tool (#252); every other tool is the caller's.
   */
  readonly structuredTool?: string
  readonly generation: PlugGeneration
  /** The end user the caller named, when kept (src/user.ts, #57). Labels the session title and the usage counts. */
  readonly user?: string
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
  // `signature` marks the end of a reasoning block: an empty-text event carrying the provider's signature for it (#146).
  | { readonly type: "reasoning-delta"; readonly text: string; readonly signature?: string; readonly redactedData?: string }
  | { readonly type: "tool-call"; readonly id: string; readonly name: string; readonly input: unknown }
  | { readonly type: "finish"; readonly reason: PlugFinish; readonly usage?: PlugUsage; readonly stopSequence?: string }
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
  /** Seconds to wait before a retry, sent as the `Retry-After` header (`sendError` in `src/http.ts`). Set by the limiter (`src/limits.ts`). */
  readonly retryAfterSeconds?: number
}

/** The one discriminator for `PlugError` values returned in place of a result. */
export const isPlugError = (value: unknown): value is PlugError => typeof value === "object" && value !== null && "status" in value && "kind" in value && "message" in value

// ---------------------------------------------------------------- caller

/** What an app's policy (option `apps`) changed in a request in a way the caller should be told about. */
export type PolicyNote = "tools-stripped"

export interface CallContext {
  /** App name (key name, or the default app). Decides the history directory. */
  readonly app: string
  /** Aborted on client disconnect or timeout. */
  readonly signal: AbortSignal
  /**
   * Aborted when a caller stop sequence ended the answer (#390, src/stop.ts). The session caller then interrupts the host run
   * and keeps the stream open until its finish, so the usage of the run is counted.
   */
  readonly stopAnswer?: AbortSignal
  /** Called once, before the first event, with the id of the history record this call writes (if any). */
  readonly onRecord?: (recordID: string, directory?: string) => void
  /**
   * Called once, before the first event, for every answered call (`src/fallback.ts`): which target answered
   * and how many earlier targets failed first. A front-end uses it for `x-plugboard-model`, and the `model`
   * it echoes when `chain` is set. A call that fails never reports it.
   */
  readonly onServed?: (served: ServedModel) => void
  /**
   * A fallback target follows this call (`src/fallback.ts` sets it when the chain has one). A retry the host schedules
   * for the call before any output then fails the call at once (`provider_retry`), so the chain moves on. Without it the
   * host's own retries run. Set by the chain only (#391).
   */
  readonly fallbackNext?: boolean
  /**
   * Called once, when the call starts work that is not the model's: preparing the prompt (fetching the request's remote images, making
   * the session). The chain's first-event deadline (`firstEventTimeoutMs`) pauses until `onPrompted`, so a slow image host is not the model's
   * silence. Set by the chain only; the session caller is the one that calls it.
   */
  readonly onPreparing?: () => void
  /** Called once, right before the prompt is sent to the host: the model is working from here, and the chain's first-event deadline starts. Set by the chain only. */
  readonly onPrompted?: () => void
  /** Called once, before the first event, with each change the app's policy made that the caller sent for. Front-ends report them in the `x-plugboard-policy` header. */
  readonly onPolicy?: (notes: ReadonlyArray<PolicyNote>) => void
  /** Called once, before the first event, when the response cache applies to the call: `hit` replays a stored answer (no session, no record), `miss` runs the model. Not called when the cache is off, skipped for the app, or `noCache` is set. */
  readonly onCache?: (result: "hit" | "miss") => void
  /** Bypass the response cache for this call. Fan-out sets it: each choice of `n` above 1 repeats one request and must be a fresh sample. */
  readonly noCache?: boolean
  /** Called once, before the first event, under `promptCache` mode `anchor`: `anchor` when the call is under its key's anchor, `none` when it got no affinity. Front-ends report it in `x-plugboard-affinity`. */
  readonly onAffinity?: (mode: "anchor" | "none") => void
  /**
   * Called once per answered call, before its finish event, when usage recording is on (`withUsage`,
   * src/usage.ts): the call's tokens and USD cost. Front-ends set `x-plugboard-usage` from it while the
   * headers are open, so a stream (headers sent first) never gets it.
   */
  readonly onUsage?: (totals: CallTotals) => void
  /**
   * Called once when the call ends without a finish event (client gone, timeout, or a stop sequence cut the run short), with
   * the host's usage for the run up to then. `withUsage` records it, so the tokens are charged to the app's budgets. The
   * finish's own usage takes precedence when there is one.
   */
  readonly onRunUsage?: (usage: PlugUsage) => void
  /**
   * Called once when the call ends, only if OpenCode ran server tools for it (option `apps.<name>.opencodeTools`),
   * with how many. Front-ends set `x-plugboard-server-tools` from it while the headers are open, so a stream
   * (headers sent first) never gets it, and a choice of `n` adds to the count of the others.
   */
  readonly onServerTools?: (count: number) => void
}

/** One answered call's totals for the caller: `inputTokens` and `outputTokens` as the response body reports them (cache reads and writes inside input, reasoning inside output), and `costUsd` when the model has a price. */
export interface CallTotals {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  /** Input tokens written to the provider's cache by this call (0 or absent when the provider reports none). */
  readonly cacheWriteTokens?: number
  readonly costUsd?: number
}

/**
 * The target that answered: `provider/model[#variant]`, and the targets tried before it. `chain` is set
 * when the request named a list alias, the only case where the response body echoes the target.
 */
export interface ServedModel {
  readonly model: string
  readonly fallbacks: number
  readonly chain?: boolean
}

/** The seam between the core and a backend (the session backend now, `ctx.llm.stream` possibly later). */
export interface ModelCaller {
  stream(request: PlugRequest, context: CallContext): AsyncIterable<PlugEvent>
}
