/**
 * Front-end: OpenAI Chat Completions <-> OpenCode V2 messages/tools/generation.
 *
 * The V2 shapes are built as plain objects here. When they reach
 * `SessionModelRequest.prepare` they are normalised through `LLM.request`, which
 * wraps each message in the real `Message` schema class, so plain objects are
 * accepted for messages/parts, except media (see `mediaPart`).
 */

export interface CallerTool {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
}

export interface AdapterRequestState {
  /** Images/files, attached to the prompt so the host builds their `Media.Asset`s (see `mediaPart`). */
  readonly attachments: Array<{ uri: string; name: string }>
  readonly system: Array<Record<string, unknown>>
  readonly messages: Array<Record<string, unknown>>
  readonly tools: CallerTool[]
  readonly options: Record<string, unknown>
}

export interface ParsedChat {
  readonly model: string
  readonly state: AdapterRequestState
  readonly stream: boolean
}

type Json = Record<string, any>

const text = (value: string) => ({ type: "text", text: value })

/**
 * `image_url.url` is an inline data URL or a remote URL. `MediaPart.media` must be a host
 * `Media.Asset` instance (`instanceof` check in the schema), and `@opencode/ai` is not a module
 * plugins can import, so plain objects fail with "Schema validation failed". Instead the image
 * is attached to the session prompt (the host builds the Asset) and this placeholder is swapped
 * for the host-built part, by index, in the `context` hook.
 */
const mediaPart = (url: string, attachments: AdapterRequestState["attachments"]) => {
  attachments.push({ uri: url, name: `image-${attachments.length}` })
  return { type: "media", __attachment: attachments.length - 1 }
}

const userContent = (content: unknown, attachments: AdapterRequestState["attachments"]): Array<Record<string, unknown>> => {
  if (typeof content === "string") return [text(content)]
  if (!Array.isArray(content)) return []
  const parts: Array<Record<string, unknown>> = []
  for (const item of content as Json[]) {
    if (item?.type === "text" && typeof item.text === "string") parts.push(text(item.text))
    else if (item?.type === "image_url" && typeof item.image_url?.url === "string") parts.push(mediaPart(item.image_url.url, attachments))
    else if (item?.type === "input_text" && typeof item.text === "string") parts.push(text(item.text))
  }
  return parts
}

const assistantContent = (message: Json, attachments: AdapterRequestState["attachments"]): Array<Record<string, unknown>> => {
  const parts: Array<Record<string, unknown>> = []
  if (typeof message.content === "string" && message.content.length > 0) parts.push(text(message.content))
  else if (Array.isArray(message.content)) parts.push(...userContent(message.content, attachments))
  for (const call of (message.tool_calls ?? []) as Json[]) {
    const fn = call?.function ?? {}
    let input: unknown = fn.arguments
    if (typeof fn.arguments === "string") {
      try {
        input = JSON.parse(fn.arguments)
      } catch {
        input = fn.arguments
      }
    }
    parts.push({ type: "tool-call", id: String(call.id ?? ""), name: String(fn.name ?? ""), input })
  }
  return parts
}

const safeJson = (value: string) => {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

const mapTools = (tools: unknown): CallerTool[] => {
  if (!Array.isArray(tools)) return []
  const mapped: CallerTool[] = []
  for (const entry of tools as Json[]) {
    const fn = entry?.function
    if (!fn?.name) continue
    mapped.push({
      name: String(fn.name),
      description: typeof fn.description === "string" ? fn.description : "",
      parameters: (fn.parameters ?? { type: "object", properties: {} }) as Record<string, unknown>,
    })
  }
  return mapped
}

const mapGeneration = (body: Json): Record<string, unknown> => {
  const generation: Record<string, unknown> = {}
  if (body.temperature !== undefined) generation.temperature = body.temperature
  if (body.top_p !== undefined) generation.topP = body.top_p
  const max = body.max_tokens ?? body.max_completion_tokens
  if (max !== undefined) generation.maxTokens = max
  if (body.stop !== undefined) generation.stop = Array.isArray(body.stop) ? body.stop : [body.stop]
  if (body.seed !== undefined) generation.seed = body.seed
  if (body.frequency_penalty !== undefined) generation.frequencyPenalty = body.frequency_penalty
  if (body.presence_penalty !== undefined) generation.presencePenalty = body.presence_penalty
  return generation
}

export function parseChatRequest(body: Json): ParsedChat {
  const raw: Json[] = Array.isArray(body.messages) ? body.messages : []
  const system: Array<Record<string, unknown>> = []
  const messages: Array<Record<string, unknown>> = []
  const attachments: AdapterRequestState["attachments"] = []
  // `role:"tool"` carries only `tool_call_id`; V2 tool results require a name.
  const toolNames = new Map<string, string>()
  for (const message of raw) {
    for (const call of (message.tool_calls ?? []) as Json[]) {
      if (call?.id) toolNames.set(String(call.id), String(call.function?.name ?? ""))
    }
  }
  for (const message of raw) {
    switch (message.role) {
      case "system":
      case "developer": {
        const value = typeof message.content === "string" ? message.content : ""
        if (value.length > 0) system.push(text(value))
        break
      }
      case "assistant":
        messages.push({ role: "assistant", content: assistantContent(message, attachments) })
        break
      case "tool": {
        const id = String(message.tool_call_id ?? "")
        const name = toolNames.get(id) ?? String(message.name ?? "tool")
        const value = typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "")
        messages.push({ role: "tool", content: [{ type: "tool-result", id, name, result: { type: "text", value } }] })
        break
      }
      case "function": {
        const id = String(message.name ?? "tool")
        messages.push({
          role: "tool",
          content: [
            { type: "tool-result", id, name: id, result: { type: "text", value: String(message.content ?? "") } },
          ],
        })
        break
      }
      default:
        messages.push({ role: "user", content: userContent(message.content, attachments) })
    }
  }
  if (system.length === 0 && messages.length === 0) messages.push({ role: "user", content: [text("")] })
  return {
    model: String(body.model ?? ""),
    stream: body.stream === true,
    state: { attachments, system, messages, tools: mapTools(body.tools), options: mapGeneration(body) },
  }
}

const FINISH_REASONS: Record<string, string> = {
  stop: "stop",
  length: "length",
  "content-filter": "content_filter",
  "tool-calls": "tool_calls",
  error: "stop",
  unknown: "stop",
}

export interface StepUsage {
  readonly input?: number
  readonly output?: number
  readonly reasoning?: number
  readonly cache?: { readonly read?: number; readonly write?: number }
}

export interface StepResult {
  readonly text: string
  readonly toolCalls: ReadonlyArray<{ readonly id: string; readonly name: string; readonly input: unknown }>
  readonly finish?: string
  readonly rawFinish?: string
  readonly tokens?: StepUsage
  readonly stepError?: unknown
}

export const mapFinish = (finish?: string) => (finish ? (FINISH_REASONS[finish] ?? "stop") : "stop")

export function encodeChatCompletion(model: string, result: StepResult) {
  const toolCalls = result.toolCalls.length > 0
  const message: Record<string, unknown> = {
    role: "assistant",
    content: result.text.length > 0 ? result.text : null,
  }
  if (toolCalls) {
    message.tool_calls = result.toolCalls.map((call, index) => ({
      id: call.id || `call_${index}`,
      type: "function",
      function: {
        name: call.name,
        arguments: typeof call.input === "string" ? call.input : JSON.stringify(call.input ?? {}),
      },
    }))
  }
  const tokens = result.tokens
  const usage = tokens
    ? {
        prompt_tokens: tokens.input ?? 0,
        completion_tokens: tokens.output ?? 0,
        total_tokens: (tokens.input ?? 0) + (tokens.output ?? 0),
        prompt_tokens_details: { cached_tokens: tokens.cache?.read ?? 0 },
        completion_tokens_details: { reasoning_tokens: tokens.reasoning ?? 0 },
      }
    : undefined
  return {
    id: `chatcmpl-${Math.random().toString(16).slice(2, 14)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: toolCalls ? "tool_calls" : mapFinish(result.finish ?? result.rawFinish),
        logprobs: null,
      },
    ],
    usage,
    // Spike-only diagnostics so the caller can see why the OpenCode turn was stopped.
    ...(result.stepError ? { x_opencode_step_error: result.stepError } : {}),
  }
}

export const encodeError = (message: string, type = "invalid_request_error", code?: string) => ({
  error: { message, type, ...(code ? { code } : {}) },
})

export { safeJson }
