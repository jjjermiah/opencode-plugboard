/**
 * OpenAI Chat Completions request -> neutral `PlugRequest` plus the `OpenAiExchange` the
 * response encoders need.
 *
 * Pure function: no I/O. The route resolves `model` to a `ModelRef` afterwards, which is why
 * the request omits `ref`.
 */
import type { PlugboardOptions } from "../config.js"
import { bodyUser, userField } from "../user.js"
import {
  isPlugError,
  type PlugError,
  type PlugGeneration,
  type PlugMessage,
  type PlugPart,
  type PlugRequest,
  type PlugTool,
  type PlugToolChoice,
} from "../contract.js"
import type { OpenAiExchange } from "./response.js"

type JsonObject = Record<string, unknown>

export interface ParsedChat {
  /** The model call, minus the model ref the route resolves from `request.model`. */
  readonly request: Omit<PlugRequest, "ref">
  /** Response presentation state for the encoders; never reaches the model call. */
  readonly exchange: OpenAiExchange
  /** `n`: independent model calls whose answers become `choices` (1..`maxN`). The route fans out when it is above 1. */
  readonly n: number
  readonly reasoningEffort?: string
}

/** Name of the forced tool that carries structured output. */
export const RESPOND_TOOL = "respond"

/** The most stop sequences OpenAI accepts. */
const MAX_STOP = 4

const isRecord = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value)

const bad = (message: string, param?: string, code?: string): PlugError => ({
  status: 400,
  kind: "invalid_request",
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
            if (typeof call.id !== "string" || call.id.length === 0)
              return bad("Each tool call needs a non-empty id", `${param}.tool_calls[${i}].id`)
            const id = call.id
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
        const name = toolNames.get(id)
        if (name === undefined)
          return bad(`Tool message answers tool_call_id "${id}", which no earlier assistant tool call has`, `${param}.tool_call_id`)
        messages.push({ role: "tool", content: [{ type: "tool-result", id, name, result }] })
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
  const names = new Set<string>()
  for (const [index, entry] of raw.entries()) {
    const fn = isRecord(entry) && entry.type === "function" && isRecord(entry.function) ? entry.function : undefined
    if (!fn || typeof fn.name !== "string" || fn.name.length === 0)
      return bad('Each tool must be {"type":"function","function":{"name":...}}', `tools[${index}]`)
    if (names.has(fn.name)) return bad(`Duplicate tool name "${fn.name}"`, `tools[${index}].function.name`)
    if (fn.description != null && typeof fn.description !== "string")
      return bad("Tool description must be a string", `tools[${index}].function.description`)
    // An omitted `parameters` is a tool without arguments; a present one must be a JSON Schema object.
    if (fn.parameters != null && !isRecord(fn.parameters))
      return bad("Tool parameters must be a JSON Schema object", `tools[${index}].function.parameters`)
    names.add(fn.name)
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

/** System instruction for `json_object`: no schema, so the caller's prompt describes the keys (OpenAI semantics). */
export const JSON_OBJECT_INSTRUCTION = "Respond with a single valid JSON object only."

/**
 * `json_schema` -> the `respond` tool (`structured`; forced unless the caller also sends tools).
 * `json_object` -> a system instruction and plain text content (`instruction`): there is no schema
 * to force a tool with.
 */
export const parseResponseFormat = (raw: unknown): { structured?: PlugTool; instruction?: string } | PlugError => {
  if (raw == null) return {}
  if (!isRecord(raw)) return bad("response_format must be an object", "response_format")
  if (raw.type === "text") return {}
  if (raw.type === "json_object") return { instruction: JSON_OBJECT_INSTRUCTION }
  if (raw.type === "json_schema") {
    const spec = raw.json_schema
    if (!isRecord(spec)) return bad("response_format.json_schema must be an object", "response_format.json_schema")
    if (spec.name != null && typeof spec.name !== "string") return bad("response_format.json_schema.name must be a string", "response_format.json_schema.name")
    if (spec.description != null && typeof spec.description !== "string")
      return bad("response_format.json_schema.description must be a string", "response_format.json_schema.description")
    if (!isRecord(spec.schema)) return bad("response_format.json_schema.schema must be a JSON Schema object", "response_format.json_schema.schema")
    return {
      structured: {
        name: RESPOND_TOOL,
        // With caller tools also on offer, this description is what tells the model which call is the final answer.
        description:
          "Give your final answer by calling this tool with JSON matching its schema." +
          (typeof spec.description === "string" ? ` ${spec.description}` : ""),
        parameters: spec.schema,
      },
    }
  }
  return bad(`Unsupported response_format type "${String(raw.type)}"`, "response_format.type")
}

/** `n` is how many completions to return. Each one is a full model call (see `src/openai/fanout.ts`), so it is capped by the `maxN` option. */
export const parseChoiceCount = (body: JsonObject, options: PlugboardOptions): number | PlugError => {
  if (body.n == null) return 1
  if (typeof body.n !== "number" || !Number.isInteger(body.n) || body.n < 1) return bad("n must be a positive integer", "n")
  if (body.n > options.maxN)
    return bad(`n=${body.n} is above the limit of ${options.maxN} (option \`maxN\`; each choice is a full model call)`, "n", "too_many_choices")
  return body.n
}

export const parseGeneration = (body: JsonObject): PlugGeneration | PlugError => {
  const out: { -readonly [K in keyof PlugGeneration]: PlugGeneration[K] } = {}
  const number = (key: string, min: number, max: number, integer: boolean): number | undefined | PlugError => {
    const value = body[key]
    if (value == null) return undefined
    if (typeof value !== "number" || !Number.isFinite(value)) return bad(`${key} must be a number`, key)
    if (integer && !Number.isInteger(value)) return bad(`${key} must be an integer`, key)
    if (value < min || value > max)
      return bad(max === Number.MAX_SAFE_INTEGER ? `${key} must be at least ${min}` : `${key} must be between ${min} and ${max}`, key)
    return value
  }
  for (const [key, field, min, max, integer] of [
    ["temperature", "temperature", 0, 2, false],
    ["top_p", "topP", 0, 1, false],
    ["presence_penalty", "presencePenalty", -2, 2, false],
    ["frequency_penalty", "frequencyPenalty", -2, 2, false],
    // max_completion_tokens is the current name; max_tokens the deprecated one. Prefer the former.
    ["max_tokens", "maxTokens", 1, Number.MAX_SAFE_INTEGER, true],
    ["max_completion_tokens", "maxTokens", 1, Number.MAX_SAFE_INTEGER, true],
  ] as const) {
    const value = number(key, min, max, integer)
    if (typeof value === "object") return value
    if (value !== undefined) out[field] = value
  }
  if (body.stop != null) {
    const stop = typeof body.stop === "string" ? [body.stop] : body.stop
    if (!Array.isArray(stop) || !stop.every((s) => typeof s === "string")) return bad("stop must be a string or an array of strings", "stop")
    if (stop.length > MAX_STOP) return bad(`stop takes at most ${MAX_STOP} sequences`, "stop")
    out.stop = stop as string[]
  }
  return out
}

export function parseChatRequest(body: unknown, options: PlugboardOptions): ParsedChat | PlugError {
  if (!isRecord(body)) return bad("Request body must be a JSON object")
  if (typeof body.model !== "string" || body.model.length === 0) return bad("model is required", "model")
  if (!Array.isArray(body.messages) || body.messages.length === 0) return bad("messages must be a non-empty array", "messages")

  // Parameters the session backend cannot honour are rejected, not ignored.
  const n = parseChoiceCount(body, options)
  if (typeof n === "object") return n
  if (body.stream != null && typeof body.stream !== "boolean") return bad("stream must be a boolean", "stream")
  if (body.logprobs === true) return bad("logprobs is not supported", "logprobs", "unsupported_parameter")
  if (body.top_logprobs != null) return bad("top_logprobs is not supported", "top_logprobs", "unsupported_parameter")

  const parsed = parseMessages(body.messages)
  if (isPlugError(parsed)) return parsed
  const callerTools = parseTools(body.tools)
  if (!Array.isArray(callerTools)) return callerTools
  const toolChoice = parseToolChoice(body.tool_choice)
  if (isPlugError(toolChoice)) return toolChoice
  const format = parseResponseFormat(body.response_format)
  if (isPlugError(format)) return format
  const respond = format.structured
  const generation = parseGeneration(body)
  if (isPlugError(generation)) return generation

  if (typeof toolChoice === "object" && !callerTools.some((tool) => tool.name === toolChoice.name))
    return bad(`tool_choice names "${toolChoice.name}", which is not in tools`, "tool_choice.function.name")
  if (respond && callerTools.some((tool) => tool.name === RESPOND_TOOL))
    return bad(
      `A tool named "${RESPOND_TOOL}" collides with response_format json_schema, which plugboard answers through that name`,
      "tools",
      "reserved_tool_name",
    )

  // json_schema + caller tools: the model may call a caller tool or `respond`, so `tool_choice` is
  // `required` (not forced to `respond`). `tool_choice: none` leaves only `respond`; naming a tool
  // contradicts a structured answer.
  if (respond && typeof toolChoice === "object")
    return bad(
      "A tool_choice that names a tool cannot be combined with response_format json_schema",
      "tool_choice",
      "unsupported_parameter",
    )
  const withCallerTools = respond !== undefined && callerTools.length > 0 && toolChoice !== "none"
  const tools = respond ? (withCallerTools ? [...callerTools, respond] : [respond]) : callerTools
  if (tools.length > options.maxTools)
    return bad(
      `Request has ${tools.length} tools; plugboard allows ${options.maxTools} (option \`maxTools\`)`,
      "tools",
      "too_many_tools",
    )

  const forced: PlugToolChoice | undefined = respond ? (withCallerTools ? "required" : { type: "tool", name: RESPOND_TOOL }) : toolChoice
  const request: Omit<PlugRequest, "ref"> = {
    ...userField(bodyUser(body)),
    model: body.model,
    system: format.instruction ? [...parsed.system, format.instruction] : parsed.system,
    messages: parsed.messages,
    tools,
    ...(forced && tools.length > 0 ? { toolChoice: forced } : {}),
    generation,
  }
  const streamOptions = isRecord(body.stream_options) ? body.stream_options : {}
  return {
    request,
    n,
    exchange: {
      model: body.model,
      stream: body.stream === true,
      includeUsage: streamOptions.include_usage === true,
      ...(respond ? { structuredTool: RESPOND_TOOL, structuredSchema: respond.parameters, ...(withCallerTools ? { callerTools: true } : {}) } : {}),
      ...(format.instruction ? { jsonObject: true } : {}),
      ...(generation.stop ? { stop: generation.stop } : {}),
    },
    ...(typeof body.reasoning_effort === "string" ? { reasoningEffort: body.reasoning_effort } : {}),
  }
}
