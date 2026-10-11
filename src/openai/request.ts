/**
 * OpenAI Chat Completions request -> PlugRequest (spec R1, D13, D22, D23).
 *
 * Pure function: no I/O. The core resolves `model` to a `ModelRef` afterwards, which is why
 * the result omits `ref`.
 */
import type {
  PlugboardOptions,
  PlugError,
  PlugGeneration,
  PlugMessage,
  PlugPart,
  PlugRequest,
  PlugTool,
  PlugToolChoice,
} from "../contract.ts"

type Json = Record<string, unknown>

export interface ParsedChat {
  readonly request: Omit<PlugRequest, "ref">
  readonly reasoningEffort?: string
  /** `stream_options.include_usage`: the stream encoder adds a final usage chunk. */
  readonly includeUsage: boolean
}

/** Name of the forced tool that carries structured output (D13). */
export const RESPOND_TOOL = "respond"

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)

const isError = (value: unknown): value is PlugError => isRecord(value) && typeof value.status === "number"

const bad = (message: string, param?: string, code?: string): PlugError => ({
  status: 400,
  type: "invalid_request_error",
  message,
  ...(code ? { code } : {}),
  ...(param ? { param } : {}),
})

/** Text of a string or an array of `{type:"text"}` parts (system, developer, tool and assistant content). */
const textOf = (content: unknown): string | undefined => {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return undefined
  const texts: string[] = []
  for (const item of content) {
    if (!isRecord(item) || typeof item.text !== "string") return undefined
    texts.push(item.text)
  }
  return texts.join("\n")
}

const dataUrlType = (url: string) => /^data:([^;,]+)[;,]/.exec(url)?.[1]

const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

/** User content: string, or parts of text / image_url / file. */
const userParts = (content: unknown, param: string): PlugPart[] | PlugError => {
  if (typeof content === "string") return [{ type: "text", text: content }]
  if (!Array.isArray(content)) return bad("Message content must be a string or an array of content parts", param)
  const parts: PlugPart[] = []
  for (const [index, item] of content.entries()) {
    const at = `${param}[${index}]`
    if (!isRecord(item)) return bad("Content part must be an object", at)
    if (item.type === "text" && typeof item.text === "string") parts.push({ type: "text", text: item.text })
    else if (item.type === "image_url" && isRecord(item.image_url) && typeof item.image_url.url === "string") {
      const url = item.image_url.url
      parts.push({ type: "media", url, ...(dataUrlType(url) ? { mediaType: dataUrlType(url) } : {}) })
    } else if (item.type === "file" && isRecord(item.file) && typeof item.file.file_data === "string") {
      const data = item.file.file_data
      const url = data.startsWith("data:") ? data : `data:application/octet-stream;base64,${data}`
      parts.push({ type: "media", url, mediaType: dataUrlType(url) })
    } else return bad(`Unsupported content part type "${String(item.type)}"`, `${at}.type`, "unsupported_parameter")
  }
  return parts
}

const parseMessages = (raw: unknown[]): { system: string[]; messages: PlugMessage[] } | PlugError => {
  const system: string[] = []
  const messages: PlugMessage[] = []
  // `role:"tool"` messages carry only `tool_call_id`; tool results need the tool's name.
  const toolNames = new Map<string, string>()

  for (const [index, message] of raw.entries()) {
    const param = `messages[${index}]`
    if (!isRecord(message)) return bad("Each message must be an object", param)
    switch (message.role) {
      case "system":
      case "developer": {
        const value = textOf(message.content)
        if (value === undefined) return bad("System message content must be a string or text parts", `${param}.content`)
        if (value.length > 0) system.push(value)
        break
      }
      case "user": {
        const parts = userParts(message.content, `${param}.content`)
        if (!Array.isArray(parts)) return parts
        messages.push({ role: "user", content: parts })
        break
      }
      case "assistant": {
        const parts: PlugPart[] = []
        if (message.content != null) {
          // Assistant content may mix text and refusal parts; keep the text.
          const value = Array.isArray(message.content)
            ? textOf(message.content.filter((p) => isRecord(p) && p.type === "text"))
            : textOf(message.content)
          if (value === undefined) return bad("Assistant content must be a string or text parts", `${param}.content`)
          if (value.length > 0) parts.push({ type: "text", text: value })
        }
        if (message.tool_calls != null) {
          if (!Array.isArray(message.tool_calls)) return bad("tool_calls must be an array", `${param}.tool_calls`)
          for (const [i, call] of message.tool_calls.entries()) {
            const fn = isRecord(call) && isRecord(call.function) ? call.function : undefined
            if (!isRecord(call) || !fn || typeof fn.name !== "string")
              return bad("Each tool call needs an id and a function name", `${param}.tool_calls[${i}]`)
            const id = typeof call.id === "string" ? call.id : `call_${index}_${i}`
            toolNames.set(id, fn.name)
            parts.push({
              type: "tool-call",
              id,
              name: fn.name,
              input: typeof fn.arguments === "string" ? parseJson(fn.arguments) : (fn.arguments ?? {}),
            })
          }
        }
        if (parts.length > 0) messages.push({ role: "assistant", content: parts })
        break
      }
      case "tool": {
        const result = textOf(message.content)
        if (typeof message.tool_call_id !== "string" || result === undefined)
          return bad("Tool messages need a tool_call_id and string or text-part content", param)
        const id = message.tool_call_id
        messages.push({ role: "tool", content: [{ type: "tool-result", id, name: toolNames.get(id) ?? "tool", result }] })
        break
      }
      default:
        return bad(`Unsupported message role "${String(message.role)}"`, `${param}.role`)
    }
  }
  return { system, messages }
}

const parseTools = (raw: unknown): PlugTool[] | PlugError => {
  if (raw == null) return []
  if (!Array.isArray(raw)) return bad("tools must be an array", "tools")
  const tools: PlugTool[] = []
  for (const [index, entry] of raw.entries()) {
    const fn = isRecord(entry) && entry.type === "function" && isRecord(entry.function) ? entry.function : undefined
    if (!fn || typeof fn.name !== "string" || fn.name.length === 0)
      return bad('Each tool must be {"type":"function","function":{"name":...}}', `tools[${index}]`)
    tools.push({
      name: fn.name,
      description: typeof fn.description === "string" ? fn.description : "",
      parameters: isRecord(fn.parameters) ? fn.parameters : { type: "object", properties: {} },
    })
  }
  return tools
}

const parseToolChoice = (raw: unknown): PlugToolChoice | undefined | PlugError => {
  if (raw == null) return undefined
  if (raw === "auto" || raw === "none" || raw === "required") return raw
  if (isRecord(raw) && raw.type === "function" && isRecord(raw.function) && typeof raw.function.name === "string")
    return { type: "tool", name: raw.function.name }
  return bad("Unsupported tool_choice", "tool_choice")
}

/** response_format json_schema / json_object -> the forced `respond` tool (D13). */
const parseResponseFormat = (raw: unknown): PlugTool | undefined | PlugError => {
  if (raw == null) return undefined
  if (!isRecord(raw)) return bad("response_format must be an object", "response_format")
  if (raw.type === "text") return undefined
  if (raw.type === "json_object")
    return { name: RESPOND_TOOL, description: "Respond with a JSON object.", parameters: { type: "object", additionalProperties: true } }
  if (raw.type === "json_schema") {
    const spec = raw.json_schema
    if (!isRecord(spec)) return bad("response_format.json_schema must be an object", "response_format.json_schema")
    return {
      name: RESPOND_TOOL,
      description: typeof spec.description === "string" ? spec.description : "Respond with JSON matching this schema.",
      parameters: isRecord(spec.schema) ? spec.schema : { type: "object", additionalProperties: true },
    }
  }
  return bad(`Unsupported response_format type "${String(raw.type)}"`, "response_format.type")
}

const parseGeneration = (body: Json): PlugGeneration | PlugError => {
  const out: { -readonly [K in keyof PlugGeneration]: PlugGeneration[K] } = {}
  const number = (key: string): number | undefined | PlugError => {
    const value = body[key]
    if (value == null) return undefined
    return typeof value === "number" && Number.isFinite(value) ? value : bad(`${key} must be a number`, key)
  }
  for (const [key, field] of [
    ["temperature", "temperature"],
    ["top_p", "topP"],
    ["presence_penalty", "presencePenalty"],
    ["frequency_penalty", "frequencyPenalty"],
    // max_completion_tokens is the current name; max_tokens the deprecated one. Prefer the former.
    ["max_tokens", "maxTokens"],
    ["max_completion_tokens", "maxTokens"],
  ] as const) {
    const value = number(key)
    if (typeof value === "object") return value
    if (value !== undefined) out[field] = value
  }
  if (body.stop != null) {
    const stop = typeof body.stop === "string" ? [body.stop] : body.stop
    if (!Array.isArray(stop) || !stop.every((s) => typeof s === "string")) return bad("stop must be a string or an array of strings", "stop")
    out.stop = stop as string[]
  }
  return out
}

export function parseChatRequest(body: unknown, options: PlugboardOptions): ParsedChat | PlugError {
  if (!isRecord(body)) return bad("Request body must be a JSON object")
  if (typeof body.model !== "string" || body.model.length === 0) return bad("model is required", "model")
  if (!Array.isArray(body.messages) || body.messages.length === 0) return bad("messages must be a non-empty array", "messages")

  // D23: parameters the session backend cannot honour are rejected, not ignored.
  if (typeof body.n === "number" && body.n > 1) return bad("Only n=1 is supported", "n", "unsupported_parameter")
  if (body.logprobs === true) return bad("logprobs is not supported", "logprobs", "unsupported_parameter")
  if (body.top_logprobs != null) return bad("top_logprobs is not supported", "top_logprobs", "unsupported_parameter")

  const parsed = parseMessages(body.messages)
  if (isError(parsed)) return parsed
  const callerTools = parseTools(body.tools)
  if (!Array.isArray(callerTools)) return callerTools
  const toolChoice = parseToolChoice(body.tool_choice)
  if (isError(toolChoice)) return toolChoice
  const respond = parseResponseFormat(body.response_format)
  if (isError(respond)) return respond
  const generation = parseGeneration(body)
  if (isError(generation)) return generation

  const tools = respond ? [...callerTools, respond] : callerTools
  if (tools.length > options.maxTools)
    return bad(
      `Request has ${tools.length} tools; plugboard allows ${options.maxTools} (option \`maxTools\`)`,
      "tools",
      "too_many_tools",
    )

  const forced: PlugToolChoice | undefined = respond ? { type: "tool", name: RESPOND_TOOL } : toolChoice
  const request: Omit<PlugRequest, "ref"> = {
    model: body.model,
    system: parsed.system,
    messages: parsed.messages,
    tools,
    ...(forced && tools.length > 0 ? { toolChoice: forced } : {}),
    generation,
    ...(respond ? { structured: { toolName: RESPOND_TOOL } } : {}),
    stream: body.stream === true,
  }
  const options_ = isRecord(body.stream_options) ? body.stream_options : {}
  return {
    request,
    includeUsage: options_.include_usage === true,
    ...(typeof body.reasoning_effort === "string" ? { reasoningEffort: body.reasoning_effort } : {}),
  }
}
