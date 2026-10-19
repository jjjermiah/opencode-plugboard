/**
 * Anthropic Messages request -> neutral `PlugRequest` plus the `MessagesExchange` the response
 * encoder needs.
 *
 * Pure function: no I/O. Stateless like the other front-ends: the caller sends the whole
 * conversation in `messages`. Server tools (web search, code execution, computer use, ...) run on
 * Anthropic's side and plugboard has no equivalent, so they are rejected with a 400
 * `invalid_request_error` naming the field. The route resolves `model` to a `ModelRef`
 * afterwards, which is why the request omits `ref`.
 */
import type { PlugboardOptions } from "../config.js"
import { show } from "../client-value.js"
import { imageProblem } from "../image.js"
import { replayedReasoning } from "../reasoning-replay.js"
import { bodyUserId, userField } from "../user.js"
import { isPlugError, type PlugError, type PlugGeneration, type PlugMessage, type PlugPart, type PlugRequest, type PlugTool, type PlugToolChoice } from "../contract.js"
import type { MessagesExchange } from "./response.js"

type JsonObject = Record<string, unknown>

export interface ParsedMessages {
  /** The model call, minus the model ref the route resolves from `request.model`. */
  readonly request: Omit<PlugRequest, "ref">
  /** Response presentation state for the encoder; never reaches the model call. */
  readonly exchange: MessagesExchange
  /** Variant name to try on the model (from `output_config.effort` or `thinking.budget_tokens`). */
  readonly reasoningEffort?: string
}

const isRecord = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value)

const bad = (message: string): PlugError => ({ status: 400, kind: "invalid_request", message })

/** Name of the forced tool that carries structured output (same as the other front-ends). */
const RESPOND_TOOL = "respond"

/** Anthropic's own minimum for `thinking.budget_tokens`. */
const MIN_THINKING_BUDGET = 1024

/** Budget ranges -> the variant names OpenCode models commonly offer (`low`, `medium`, `high`). A model without that variant gets the nearest one above it (`effortVariant`, #410). */
const effortOfBudget = (budget: number) => (budget <= 4096 ? "low" : budget <= 16384 ? "medium" : "high")

const MEDIA_TYPE = /^[\w.+-]+\/[\w.+-]+$/

/** A base64 or url `source` of an image or document block -> media part. */
const mediaPart = (block: JsonObject, at: string, what: "image" | "document"): PlugPart | PlugError => {
  const source = block.source
  if (!isRecord(source)) return bad(`${at}.source: Field required`)
  if (source.type === "base64") {
    if (typeof source.media_type !== "string" || !MEDIA_TYPE.test(source.media_type)) return bad(`${at}.source.media_type: must be a media type such as image/png`)
    if (typeof source.data !== "string") return bad(`${at}.source.data: must be a base64 string`)
    const url = `data:${source.media_type};base64,${source.data}`
    const problem = what === "image" ? imageProblem(url) : undefined
    if (problem) return bad(`${at}.source.data: ${problem}`)
    return { type: "media", url, mediaType: source.media_type }
  }
  if (source.type === "url") {
    if (typeof source.url !== "string" || source.url.length === 0) return bad(`${at}.source.url: must be a non-empty string`)
    return { type: "media", url: source.url }
  }
  if (what === "document" && source.type === "text") {
    if (typeof source.data !== "string") return bad(`${at}.source.data: must be a string`)
    return { type: "text", text: source.data }
  }
  return bad(`${at}.source.type: "${show(source.type)}" is not supported for ${what} blocks (use base64 or url)`)
}

/**
 * A `thinking` block with a signature, or a `redacted_thinking` block: the reasoning a provider can verify on replay (#374). An
 * unsigned `thinking` block is dropped (undefined): it has no signature to replay. Malformed blocks are dropped too,
 * as they were before this change, so a request that used to pass still passes.
 */
const reasoningPart = (block: JsonObject): PlugPart | undefined => {
  if (block.type === "redacted_thinking") {
    return typeof block.data === "string" && block.data.length > 0 ? { type: "reasoning", text: "", redactedData: block.data } : undefined
  }
  if (typeof block.thinking !== "string" || typeof block.signature !== "string" || block.signature.length === 0) return undefined
  // The text the provider signed: a block whose text plugboard rewrote (#411) is replayed as it was signed.
  return { type: "reasoning", text: replayedReasoning(block.signature, block.thinking), signature: block.signature }
}

/** Text of a tool_result `content`: a string, or text blocks; image blocks are returned separately. */
const toolResultContent = (content: unknown, at: string): { text: string; media: PlugPart[] } | PlugError => {
  if (content == null) return { text: "", media: [] }
  if (typeof content === "string") return { text: content, media: [] }
  if (!Array.isArray(content)) return bad(`${at}.content: must be a string or an array of content blocks`)
  const texts: string[] = []
  const media: PlugPart[] = []
  for (const [index, block] of content.entries()) {
    const here = `${at}.content.${index}`
    if (!isRecord(block)) return bad(`${here}: must be an object`)
    if (block.type === "text" && typeof block.text === "string") texts.push(block.text)
    else if (block.type === "image" || block.type === "document") {
      const part = mediaPart(block, here, block.type)
      if (isPlugError(part)) return part
      if (part.type === "text") texts.push(part.text)
      else media.push(part)
    } else return bad(`${here}.type: "${show(block.type)}" is not supported in tool_result content (use text or image)`)
  }
  return { text: texts.join("\n"), media }
}

/**
 * A caller's `cache_control` breakpoint on a content block (#275). `cacheTtl` is `"1h"` only for `ttl: "1h"`; any other ttl or none is
 * the default 5 minutes. Whether the 1h TTL reaches the model is decided in `src/session/context.ts`.
 */
const cached = (block: JsonObject): { cache?: true; cacheTtl?: "1h" } => {
  const control = block.cache_control
  if (!isRecord(control) || control.type !== "ephemeral") return {}
  return control.ttl === "1h" ? { cache: true, cacheTtl: "1h" } : { cache: true }
}

/** Plain content blocks (text, image, document) of a user message, in order. */
const userBlock = (block: JsonObject, at: string): PlugPart | undefined | PlugError => {
  switch (block.type) {
    case "text":
      if (typeof block.text !== "string") return bad(`${at}.text: must be a string`)
      return block.text.length > 0 ? { type: "text", text: block.text, ...cached(block) } : undefined
    case "image":
    case "document": {
      const part = mediaPart(block, at, block.type)
      return isPlugError(part) ? part : { ...part, ...cached(block) }
    }
    default:
      return bad(`${at}.type: "${show(block.type)}" is not supported in user messages (use text, image, document or tool_result)`)
  }
}

const parseMessages = (raw: unknown): PlugMessage[] | PlugError => {
  if (raw == null) return bad("messages: Field required")
  if (!Array.isArray(raw) || raw.length === 0) return bad("messages: must be a non-empty array")
  const messages: PlugMessage[] = []
  const toolNames = new Map<string, string>()

  for (const [index, message] of raw.entries()) {
    const at = `messages.${index}`
    if (!isRecord(message)) return bad(`${at}: must be an object`)
    if (message.role !== "user" && message.role !== "assistant") return bad(`${at}.role: must be "user" or "assistant" (put system prompts in the top-level system field)`)
    const content = message.content
    if (content == null) return bad(`${at}.content: Field required`)
    const blocks: unknown[] = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : []
    if (typeof content !== "string" && !Array.isArray(content)) return bad(`${at}.content: must be a string or an array of content blocks`)

    if (message.role === "assistant") {
      const parts: PlugPart[] = []
      for (const [i, block] of blocks.entries()) {
        const here = `${at}.content.${i}`
        if (!isRecord(block)) return bad(`${here}: must be an object`)
        if (block.type === "thinking" || block.type === "redacted_thinking") {
          const part = reasoningPart(block)
          if (part) parts.push(part)
        } else if (block.type === "text") {
          if (typeof block.text !== "string") return bad(`${here}.text: must be a string`)
          if (block.text.length > 0) parts.push({ type: "text", text: block.text, ...cached(block) })
        } else if (block.type === "tool_use") {
          if (typeof block.id !== "string" || block.id.length === 0) return bad(`${here}.id: Field required`)
          if (typeof block.name !== "string" || block.name.length === 0) return bad(`${here}.name: Field required`)
          if (block.input != null && !isRecord(block.input)) return bad(`${here}.input: must be an object`)
          toolNames.set(block.id, block.name)
          parts.push({ type: "tool-call", id: block.id, name: block.name, input: block.input ?? {} })
        } else return bad(`${here}.type: "${show(block.type)}" is not supported in assistant messages (use text, thinking, redacted_thinking or tool_use)`)
      }
      if (parts.length > 0) messages.push({ role: "assistant", content: parts })
      continue
    }

    // A user turn: text, images and documents, plus tool_result blocks that answer the previous
    // assistant turn. Each result becomes its own `tool` message; images inside results (which a
    // tool message cannot carry) follow the results as user media.
    let user: PlugPart[] = []
    let hoisted: PlugPart[] = []
    const flushUser = () => {
      if (user.length > 0) messages.push({ role: "user", content: user })
      user = []
    }
    const takeHoisted = () => {
      if (hoisted.length === 0) return
      user.push({ type: "text", text: "Images returned by the tool calls above:" }, ...hoisted)
      hoisted = []
    }
    for (const [i, block] of blocks.entries()) {
      const here = `${at}.content.${i}`
      if (!isRecord(block)) return bad(`${here}: must be an object`)
      if (block.type === "tool_result") {
        if (typeof block.tool_use_id !== "string" || block.tool_use_id.length === 0) return bad(`${here}.tool_use_id: Field required`)
        const name = toolNames.get(block.tool_use_id)
        if (name === undefined) return bad(`${here}.tool_use_id: "${block.tool_use_id}" matches no tool_use block in an earlier assistant message`)
        const result = toolResultContent(block.content, here)
        if (isPlugError(result)) return result
        flushUser()
        messages.push({
          role: "tool",
          content: [{ type: "tool-result", id: block.tool_use_id, name, result: result.text, ...(block.is_error === true ? { isError: true } : {}), ...cached(block) }],
        })
        hoisted.push(...result.media)
        continue
      }
      takeHoisted()
      const part = userBlock(block, here)
      if (isPlugError(part)) return part
      if (part) user.push(part)
    }
    takeHoisted()
    flushUser()
  }
  if (messages.length === 0) return bad("messages: no non-empty content")
  return messages
}

/** `system`: a string or text blocks (`cache_control` is accepted and ignored). */
const parseSystem = (raw: unknown): string[] | PlugError => {
  if (raw == null) return []
  if (typeof raw === "string") return raw.length > 0 ? [raw] : []
  if (!Array.isArray(raw)) return bad("system: must be a string or an array of text blocks")
  const system: string[] = []
  for (const [index, block] of raw.entries()) {
    if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") return bad(`system.${index}: must be a text block`)
    if (block.text.length > 0) system.push(block.text)
  }
  return system
}

const parseTools = (raw: unknown): PlugTool[] | PlugError => {
  if (raw == null) return []
  if (!Array.isArray(raw)) return bad("tools: must be an array")
  const tools: PlugTool[] = []
  const names = new Set<string>()
  for (const [index, entry] of raw.entries()) {
    const at = `tools.${index}`
    if (!isRecord(entry)) return bad(`${at}: must be an object`)
    if (entry.type != null && entry.type !== "custom")
      return bad(
        `${at}.type: "${show(entry.type)}" is not supported. Only custom tools with an input_schema are: server tools (web_search, web_fetch, code_execution, ...) run on Anthropic's side, and computer use, bash and text editor tools are not available through plugboard`,
      )
    if (typeof entry.name !== "string" || entry.name.length === 0) return bad(`${at}.name: Field required`)
    if (names.has(entry.name)) return bad(`${at}.name: duplicate tool name "${entry.name}"`)
    if (entry.description != null && typeof entry.description !== "string") return bad(`${at}.description: must be a string`)
    if (!isRecord(entry.input_schema)) return bad(`${at}.input_schema: Field required (a JSON Schema object)`)
    names.add(entry.name)
    tools.push({ name: entry.name, description: typeof entry.description === "string" ? entry.description : "", parameters: entry.input_schema })
  }
  return tools
}

const parseToolChoice = (raw: unknown): PlugToolChoice | undefined | PlugError => {
  if (raw == null) return undefined
  if (!isRecord(raw)) return bad("tool_choice: must be an object")
  switch (raw.type) {
    case "auto":
      return "auto"
    case "any":
      return "required"
    case "none":
      return "none"
    case "tool":
      if (typeof raw.name !== "string" || raw.name.length === 0) return bad("tool_choice.name: Field required")
      return { type: "tool", name: raw.name }
    default:
      return bad(`tool_choice.type: must be one of auto, any, tool, none`)
  }
}

/**
 * `output_config.format` (`{type: "json_schema", schema}`) -> the `respond` tool, forced unless the caller also sends tools; the
 * same mapping as `response_format` json_schema in Chat Completions. `null` or absent: no structured output.
 */
const parseOutputFormat = (body: JsonObject): PlugTool | undefined | PlugError => {
  const config = body.output_config
  if (!isRecord(config) || config.format == null) return undefined
  const format = config.format
  if (!isRecord(format)) return bad("output_config.format: must be an object")
  if (format.type !== "json_schema") return bad(`output_config.format.type: "${show(format.type)}" is not supported (use "json_schema")`)
  if (!isRecord(format.schema)) return bad("output_config.format.schema: Field required (a JSON Schema object)")
  return {
    name: RESPOND_TOOL,
    // With caller tools also on offer, this description is what tells the model which call is the final answer.
    description: "Give your final answer by calling this tool with JSON matching its schema.",
    parameters: format.schema,
  }
}

const parseGeneration = (body: JsonObject): PlugGeneration | PlugError => {
  const out: { -readonly [K in keyof PlugGeneration]: PlugGeneration[K] } = {}
  if (typeof body.max_tokens !== "number" || !Number.isInteger(body.max_tokens)) {
    return bad(body.max_tokens == null ? "max_tokens: Field required" : "max_tokens: must be an integer")
  }
  if (body.max_tokens < 1) return bad("max_tokens: must be at least 1")
  out.maxTokens = body.max_tokens
  for (const [key, field] of [
    ["temperature", "temperature"],
    ["top_p", "topP"],
  ] as const) {
    const value = body[key]
    if (value == null) continue
    if (typeof value !== "number" || !Number.isFinite(value)) return bad(`${key}: must be a number`)
    if (value < 0 || value > 1) return bad(`${key}: must be between 0 and 1`)
    out[field] = value
  }
  if (body.top_k != null) {
    if (typeof body.top_k !== "number" || !Number.isInteger(body.top_k) || body.top_k < 0) return bad("top_k: must be a non-negative integer")
    out.topK = body.top_k
  }
  if (body.stop_sequences != null) {
    if (!Array.isArray(body.stop_sequences) || body.stop_sequences.some((s) => typeof s !== "string" || s.length === 0)) return bad("stop_sequences: must be an array of non-empty strings")
    if (body.stop_sequences.length > 0) out.stop = body.stop_sequences as string[]
  }
  return out
}

/** `thinking` and `output_config.effort` -> whether thinking blocks are wanted and a variant name to try. */
const parseThinking = (body: JsonObject, maxTokens: number): { enabled: boolean; effort?: string } | PlugError => {
  let enabled = false
  let effort: string | undefined
  const thinking = body.thinking
  if (thinking != null) {
    if (!isRecord(thinking)) return bad("thinking: must be an object")
    if (thinking.type === "enabled") {
      const budget = thinking.budget_tokens
      if (typeof budget !== "number" || !Number.isInteger(budget)) return bad("thinking.budget_tokens: Field required (an integer)")
      if (budget < MIN_THINKING_BUDGET) return bad(`thinking.budget_tokens: must be at least ${MIN_THINKING_BUDGET}`)
      if (budget >= maxTokens) return bad("thinking.budget_tokens: must be less than max_tokens")
      enabled = true
      effort = effortOfBudget(budget)
    } else if (thinking.type === "adaptive") enabled = true
    else if (thinking.type !== "disabled") return bad('thinking.type: must be "enabled", "adaptive" or "disabled"')
  }
  const config = body.output_config
  if (config != null) {
    if (!isRecord(config)) return bad("output_config: must be an object")
    if (config.effort != null) {
      if (typeof config.effort !== "string" || config.effort.length === 0) return bad("output_config.effort: must be a string")
      effort = config.effort
    }
  }
  return { enabled, ...(effort ? { effort } : {}) }
}

export function parseMessagesRequest(body: unknown, options: PlugboardOptions): ParsedMessages | PlugError {
  if (!isRecord(body)) return bad("Request body must be a JSON object")
  if (typeof body.model !== "string" || body.model.length === 0) return bad("model: Field required")
  if (body.stream != null && typeof body.stream !== "boolean") return bad("stream: must be a boolean")
  if (Array.isArray(body.mcp_servers) && body.mcp_servers.length > 0) return bad("mcp_servers: not supported (MCP connectors run on Anthropic's side)")

  const generation = parseGeneration(body)
  if (isPlugError(generation)) return generation
  // Claude Code sends a `system` role message for models it doesn't know (any non-Claude id), which the real API
  // would reject. Lift those into the system prompt so any OpenCode model works behind Claude Code.
  const rawMessages: unknown = body.messages
  const lifted = Array.isArray(rawMessages) ? rawMessages.filter((m) => isRecord(m) && m.role === "system") : []
  const messages = parseMessages(Array.isArray(rawMessages) && lifted.length > 0 ? rawMessages.filter((m) => !lifted.includes(m)) : rawMessages)
  if (isPlugError(messages)) return messages
  const base = parseSystem(body.system)
  if (isPlugError(base)) return base
  const extra: string[] = []
  for (const m of lifted) {
    const s = parseSystem((m as Record<string, unknown>).content)
    if (isPlugError(s)) return s
    extra.push(...s)
  }
  const system = [...base, ...extra]
  const tools = parseTools(body.tools)
  if (isPlugError(tools)) return tools
  const toolChoice = parseToolChoice(body.tool_choice)
  if (isPlugError(toolChoice)) return toolChoice
  const thinking = parseThinking(body, generation.maxTokens ?? 1)
  if (isPlugError(thinking)) return thinking

  const respond = parseOutputFormat(body)
  if (isPlugError(respond)) return respond

  if (toolChoice !== undefined && toolChoice !== "none" && toolChoice !== "auto" && tools.length === 0) return bad("tool_choice: needs at least one tool in tools")
  if (typeof toolChoice === "object" && !tools.some((tool) => tool.name === toolChoice.name)) return bad(`tool_choice.name: "${toolChoice.name}" is not in tools`)
  if (respond && tools.some((tool) => tool.name === RESPOND_TOOL)) return bad(`tools: a tool named "${RESPOND_TOOL}" collides with output_config.format, which plugboard answers through that name`)
  // output_config.format + caller tools: the model may call a caller tool or `respond`, so `tool_choice` is `required` (not forced to
  // `respond`). `tool_choice: none` leaves only `respond`; naming a tool contradicts a structured answer.
  if (respond && typeof toolChoice === "object") return bad("tool_choice: a tool_choice that names a tool cannot be combined with output_config.format")
  const withCallerTools = respond !== undefined && tools.length > 0 && toolChoice !== "none"
  const offered = respond ? (withCallerTools ? [...tools, respond] : [respond]) : tools
  if (offered.length > options.maxTools) return bad(`tools: ${offered.length} tools; plugboard allows ${options.maxTools} (option \`maxTools\`)`)
  const forced: PlugToolChoice | undefined = respond ? (withCallerTools ? "required" : { type: "tool", name: RESPOND_TOOL }) : toolChoice

  const request: Omit<PlugRequest, "ref"> = {
    ...userField(bodyUserId(body)),
    model: body.model,
    system,
    messages,
    tools: offered,
    ...(forced && (offered.length > 0 || forced === "none") ? { toolChoice: forced } : {}),
    ...(respond ? { structuredTool: RESPOND_TOOL } : {}),
    generation,
    // `tool_choice.disable_parallel_tool_use` (#202): one tool call per answer.
    ...(isRecord(body.tool_choice) && body.tool_choice.disable_parallel_tool_use === true ? { parallelToolCalls: false } : {}),
  }
  return {
    request,
    exchange: {
      model: body.model,
      stream: body.stream === true,
      thinking: thinking.enabled,
      ...(respond ? { structuredTool: RESPOND_TOOL, structuredSchema: respond.parameters, ...(withCallerTools ? { callerTools: true } : {}) } : {}),
    },
    ...(thinking.effort ? { reasoningEffort: thinking.effort } : {}),
  }
}
