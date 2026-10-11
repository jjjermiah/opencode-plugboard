/**
 * TEMPORARY dev shim: minimal `RouteDeps` so lane `runtime` can run live before the config and
 * OpenAI lanes merge. Deleted at merge; `index.ts` then imports the real functions.
 */

import { DEFAULT_APP, DEFAULTS, type CatalogModel, type ModelRef, type PlugError, type PlugEvent, type PlugMessage, type PlugPart, type PlugRequest, type PlugboardOptions, type PlugFinish } from "./contract.js"
import type { RouteDeps } from "./server.js"

type Json = Record<string, any>

const err = (status: number, type: PlugError["type"], message: string, code?: string): PlugError => ({ status, type, message, ...(code ? { code } : {}) })

function parseOptions(raw: unknown): PlugboardOptions {
  const o = (raw ?? {}) as Json
  return {
    listen: { host: String(o.listen?.host ?? DEFAULTS.host), port: Number(o.listen?.port ?? DEFAULTS.port) },
    keys: (o.keys ?? {}) as Record<string, string>,
    models: Array.isArray(o.models) ? o.models.map(String) : [],
    aliases: (o.aliases ?? {}) as Record<string, string>,
    maxTools: Number(o.maxTools ?? DEFAULTS.maxTools),
    requestTimeoutMs: Number(o.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs),
  }
}

function authenticate(options: PlugboardOptions, authorization: string | undefined): { app: string } | PlugError {
  const entries = Object.entries(options.keys)
  if (entries.length === 0) return { app: DEFAULT_APP }
  const token = authorization?.replace(/^Bearer\s+/i, "")
  const hit = entries.find(([, key]) => key === token)
  return hit ? { app: hit[0] } : err(401, "authentication_error", "Missing or invalid API key", "invalid_api_key")
}

function toCatalog(raw: unknown[]): CatalogModel[] {
  const out: CatalogModel[] = []
  for (const item of raw as Json[]) {
    const providerID = String(item.providerID ?? "")
    const id = String(item.modelID ?? item.id ?? "")
    if (!providerID || !id) continue
    out.push({
      providerID,
      id,
      name: item.name,
      variants: ((item.variants ?? []) as Json[]).map((v) => String(v?.id ?? "")).filter(Boolean),
    })
  }
  return out
}

const toRef = (s: string): ModelRef | undefined => {
  const hash = s.indexOf("#")
  const head = hash === -1 ? s : s.slice(0, hash)
  const slash = head.indexOf("/")
  if (slash <= 0 || slash === head.length - 1) return undefined
  return { providerID: head.slice(0, slash), id: head.slice(slash + 1), ...(hash !== -1 && s.slice(hash + 1) ? { variant: s.slice(hash + 1) } : {}) }
}

const allowed = (options: PlugboardOptions, ref: ModelRef) =>
  options.models.some((pattern) => {
    if (pattern === `${ref.providerID}/*`) return true
    const p = toRef(pattern)
    return !!p && p.providerID === ref.providerID && p.id === ref.id && (p.variant === undefined || p.variant === ref.variant)
  })

function resolveModel(options: PlugboardOptions, model: string, catalog: CatalogModel[], effort?: string): ModelRef | PlugError {
  if (options.models.length === 0) return err(403, "permission_error", "No models are allowed: set the plugboard `models` option", "no_models_configured")
  let ref = toRef(options.aliases[model] ?? model)
  if (ref && effort && !ref.variant) {
    const known = catalog.find((m) => m.providerID === ref!.providerID && m.id === ref!.id)
    if (known?.variants.includes(effort)) ref = { ...ref, variant: effort }
  }
  const exists = ref && catalog.some((m) => m.providerID === ref!.providerID && m.id === ref!.id)
  if (!ref || !exists || !allowed(options, ref)) return err(404, "not_found_error", `Model ${model} is not available`, "model_not_found")
  return ref
}

function listModels(options: PlugboardOptions, catalog: CatalogModel[]): object[] {
  const data: object[] = []
  for (const m of catalog) {
    for (const variant of [undefined, ...m.variants]) {
      const ref = { providerID: m.providerID, id: m.id, ...(variant ? { variant } : {}) }
      if (allowed(options, ref)) data.push({ id: `${m.providerID}/${m.id}${variant ? `#${variant}` : ""}`, object: "model", created: 0, owned_by: m.providerID })
    }
  }
  for (const alias of Object.keys(options.aliases)) data.push({ id: alias, object: "model", created: 0, owned_by: "plugboard" })
  return data
}

// ------------------------------------------------------------------ request

const safeJson = (value: string): unknown => {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function content(value: unknown): PlugPart[] {
  if (typeof value === "string") return value.length > 0 ? [{ type: "text", text: value }] : []
  if (!Array.isArray(value)) return []
  const parts: PlugPart[] = []
  for (const item of value as Json[]) {
    if ((item?.type === "text" || item?.type === "input_text") && typeof item.text === "string") parts.push({ type: "text", text: item.text })
    else if (item?.type === "image_url" && typeof item.image_url?.url === "string") parts.push({ type: "media", url: item.image_url.url })
  }
  return parts
}

function parseChatRequest(body: unknown, options: PlugboardOptions): { request: Omit<PlugRequest, "ref">; reasoningEffort?: string } | PlugError {
  const b = (body ?? {}) as Json
  const raw: Json[] = Array.isArray(b.messages) ? b.messages : []
  const tools = Array.isArray(b.tools) ? (b.tools as Json[]).filter((t) => t?.function?.name) : []
  if (tools.length > options.maxTools)
    return err(400, "invalid_request_error", `Request has ${tools.length} tools; plugboard allows ${options.maxTools} (option \`maxTools\`)`, "too_many_tools")
  const names = new Map<string, string>()
  for (const m of raw) for (const c of (m.tool_calls ?? []) as Json[]) if (c?.id) names.set(String(c.id), String(c.function?.name ?? ""))
  const system: string[] = []
  const messages: PlugMessage[] = []
  for (const m of raw) {
    if (m.role === "system" || m.role === "developer") {
      const text = content(m.content).flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n")
      if (text) system.push(text)
    } else if (m.role === "assistant") {
      const parts = content(m.content)
      for (const c of (m.tool_calls ?? []) as Json[])
        parts.push({ type: "tool-call", id: String(c.id ?? ""), name: String(c.function?.name ?? ""), input: typeof c.function?.arguments === "string" ? safeJson(c.function.arguments) : c.function?.arguments })
      messages.push({ role: "assistant", content: parts })
    } else if (m.role === "tool") {
      const id = String(m.tool_call_id ?? "")
      const result = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")
      messages.push({ role: "tool", content: [{ type: "tool-result", id, name: names.get(id) ?? String(m.name ?? "tool"), result }] })
    } else messages.push({ role: "user", content: content(m.content) })
  }
  if (system.length === 0 && messages.length === 0) messages.push({ role: "user", content: [{ type: "text", text: "" }] })
  const choice = b.tool_choice
  const stop = b.stop === undefined ? undefined : Array.isArray(b.stop) ? b.stop.map(String) : [String(b.stop)]
  return {
    reasoningEffort: typeof b.reasoning_effort === "string" ? b.reasoning_effort : undefined,
    request: {
      model: String(b.model ?? ""),
      system,
      messages,
      tools: tools.map((t) => ({ name: String(t.function.name), description: String(t.function.description ?? ""), parameters: (t.function.parameters ?? { type: "object", properties: {} }) as Json })),
      toolChoice: choice === "none" || choice === "required" || choice === "auto" ? choice : choice?.function?.name ? { type: "tool", name: String(choice.function.name) } : undefined,
      generation: {
        maxTokens: b.max_completion_tokens ?? b.max_tokens,
        temperature: b.temperature,
        topP: b.top_p,
        stop,
        presencePenalty: b.presence_penalty,
        frequencyPenalty: b.frequency_penalty,
      },
      stream: b.stream === true,
    },
  }
}

// ------------------------------------------------------------------ response

const FINISH: Record<PlugFinish, string> = { stop: "stop", length: "length", "tool-calls": "tool_calls", "content-filter": "content_filter", error: "stop" }

const encodeError = (error: PlugError): object => ({ error: { message: error.message, type: error.type, ...(error.code ? { code: error.code } : {}), ...(error.param ? { param: error.param } : {}) } })

const usageOf = (usage?: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number; cacheReadTokens?: number }) =>
  usage
    ? {
        prompt_tokens: usage.inputTokens ?? 0,
        completion_tokens: usage.outputTokens ?? 0,
        total_tokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
        prompt_tokens_details: { cached_tokens: usage.cacheReadTokens ?? 0 },
        completion_tokens_details: { reasoning_tokens: usage.reasoningTokens ?? 0 },
      }
    : undefined

const newID = () => `chatcmpl-${Math.random().toString(16).slice(2, 14)}`

async function collectCompletion(events: AsyncIterable<PlugEvent>, request: PlugRequest): Promise<{ status: number; body: object }> {
  let text = ""
  const calls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = []
  let finish: PlugFinish = "stop"
  let usage
  for await (const e of events) {
    if (e.type === "text-delta") text += e.text
    else if (e.type === "tool-call") calls.push({ id: e.id, type: "function", function: { name: e.name, arguments: typeof e.input === "string" ? e.input : JSON.stringify(e.input ?? {}) } })
    else if (e.type === "finish") {
      finish = e.reason
      usage = e.usage
    } else if (e.type === "error") return { status: e.error.status, body: encodeError(e.error) }
  }
  const message: Json = { role: "assistant", content: text.length > 0 ? text : null, ...(calls.length > 0 ? { tool_calls: calls } : {}) }
  return {
    status: 200,
    body: { id: newID(), object: "chat.completion", created: Math.floor(Date.now() / 1000), model: request.model, choices: [{ index: 0, message, finish_reason: FINISH[finish], logprobs: null }], usage: usageOf(usage) },
  }
}

async function streamCompletion(events: AsyncIterable<PlugEvent>, request: PlugRequest, write: (chunk: string) => void): Promise<void> {
  const id = newID()
  const created = Math.floor(Date.now() / 1000)
  const chunk = (delta: Json, finish: string | null = null, extra: Json = {}) =>
    write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: request.model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`)
  chunk({ role: "assistant", content: "" })
  let index = 0
  for await (const e of events) {
    if (e.type === "text-delta") chunk({ content: e.text })
    else if (e.type === "tool-call")
      chunk({ tool_calls: [{ index: index++, id: e.id, type: "function", function: { name: e.name, arguments: typeof e.input === "string" ? e.input : JSON.stringify(e.input ?? {}) } }] })
    else if (e.type === "finish") {
      chunk({}, FINISH[e.reason])
      const usage = usageOf(e.usage)
      if (usage) write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: request.model, choices: [], usage })}\n\n`)
    } else if (e.type === "error") write(`data: ${JSON.stringify(encodeError(e.error))}\n\n`)
  }
  write("data: [DONE]\n\n")
}

export const devDeps: RouteDeps = { parseOptions, authenticate, toCatalog, resolveModel, listModels, parseChatRequest, collectCompletion, streamCompletion, encodeError }
