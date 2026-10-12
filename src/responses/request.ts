/**
 * OpenAI Responses request -> neutral `PlugRequest` plus the `ResponsesExchange` the response
 * encoder needs.
 *
 * Pure function: no I/O. The caller sends the whole conversation in `input` each time, which is
 * how history already works. An `item_reference` is resolved through the `resolve` argument (the
 * route passes the per-app store of recent answers, src/responses/store.ts; #147). Anything else that
 * needs server-side state (`previous_response_id`, `conversation`, `background`) or a hosted tool
 * is rejected with 400 `unsupported_parameter` naming the field. The route resolves `model` to a
 * `ModelRef` afterwards, which is why the request omits `ref`.
 */
import type { PlugboardOptions } from "../config.js"
import { imageProblem, pdfProblem } from "../image.js"
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
import type { ResponsesExchange } from "./response.js"

type JsonObject = Record<string, unknown>

export interface ParsedResponses {
  /** The model call, minus the model ref the route resolves from `request.model`. */
  readonly request: Omit<PlugRequest, "ref">
  /** Response presentation state for the encoder; never reaches the model call. */
  readonly exchange: ResponsesExchange
  readonly reasoningEffort?: string
}

/** Name of the forced tool that carries structured output (same as the Chat Completions front-end). */
const RESPOND_TOOL = "respond"

/** System instruction for `json_object`: no schema, so the caller's prompt describes the keys. */
const JSON_OBJECT_INSTRUCTION = "Respond with a single valid JSON object only."

const isRecord = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value)

const bad = (message: string, param?: string, code?: string): PlugError => ({
  status: 400,
  kind: "invalid_request",
  message,
  ...(code ? { code } : {}),
  ...(param ? { param } : {}),
})

const unsupported = (message: string, param: string) => bad(message, param, "unsupported_parameter")

const dataUrlType = (url: string) => /^data:([^;,]+)[;,]/.exec(url)?.[1]

const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

/** Text of a string or a list of `input_text` / `output_text` parts (system, developer, tool output). */
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

/** Content of a user message: string, or parts of `input_text` / `input_image` / `input_file`. */
const userParts = (content: unknown, param: string): PlugPart[] | PlugError => {
  if (typeof content === "string") return [{ type: "text", text: content }]
  if (!Array.isArray(content)) return bad("Message content must be a string or an array of content parts", param)
  const parts: PlugPart[] = []
  for (const [index, item] of content.entries()) {
    const at = `${param}[${index}]`
    if (!isRecord(item)) return bad("Content part must be an object", at)
    if ((item.type === "input_text" || item.type === "output_text") && typeof item.text === "string") {
      parts.push({ type: "text", text: item.text })
    } else if (item.type === "input_image" || item.type === "image_url") {
      // `image_url` is the Chat Completions part type; @langchain/openai sends it in Responses input for standard image blocks.
      const url = typeof item.image_url === "string" ? item.image_url : isRecord(item.image_url) ? item.image_url.url : undefined
      if (typeof url !== "string")
        return unsupported(item.file_id != null ? "input_image.file_id is not supported (stateless); send image_url" : "input_image needs an image_url", `${at}.image_url`)
      const problem = imageProblem(url)
      if (problem) return bad(problem, `${at}.image_url`, "invalid_image")
      parts.push({ type: "media", url, ...(dataUrlType(url) ? { mediaType: dataUrlType(url) } : {}) })
    } else if (item.type === "input_file") {
      if (typeof item.file_data === "string") {
        const data = item.file_data
        const filename = typeof item.filename === "string" ? item.filename.toLowerCase() : ""
        const url = data.startsWith("data:") ? data : `data:${filename.endsWith(".pdf") ? "application/pdf" : "application/octet-stream"};base64,${data}`
        const problem = pdfProblem(url)
        if (problem) return bad(problem, `${at}.file_data`, "invalid_file")
        parts.push({ type: "media", url, mediaType: dataUrlType(url) })
      } else if (typeof item.file_url === "string") {
        parts.push({ type: "media", url: item.file_url })
      } else return unsupported("input_file needs file_data or file_url; file_id is not supported (stateless)", `${at}.file_data`)
    } else return unsupported(`Unsupported content part type "${String(item.type)}"`, `${at}.type`)
  }
  return parts
}

/** Assistant content: string, or `output_text` parts (refusals are dropped, like the Chat Completions front-end). */
const assistantText = (content: unknown, param: string): string | PlugError => {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return bad("Assistant content must be a string or an array of output_text parts", param)
  const texts: string[] = []
  for (const [index, item] of content.entries()) {
    if (!isRecord(item)) return bad("Content part must be an object", `${param}[${index}]`)
    if (item.type === "refusal") continue
    if ((item.type !== "output_text" && item.type !== "input_text") || typeof item.text !== "string")
      return unsupported(`Unsupported assistant content part type "${String(item.type)}"`, `${param}[${index}].type`)
    texts.push(item.text)
  }
  return texts.join("")
}

/**
 * `input` items -> neutral messages. Adjacent assistant items (text, function calls) become one
 * assistant message, the shape the Chat Completions front-end produces, so a parallel-call turn
 * is one message followed by its results.
 */
/** The output item an `item_reference` names, or undefined when the app's store does not hold it. */
export type ItemResolver = (itemId: string) => JsonObject | undefined

/** An `item_reference` is the output item of an earlier answer, decoded as that item (#147). */
const resolveReference = (item: JsonObject, param: string, resolve: ItemResolver | undefined): JsonObject | PlugError => {
  if (typeof item.id !== "string" || item.id.length === 0) return bad("item_reference needs the id of an output item", `${param}.id`)
  const found = resolve?.(item.id)
  if (found === undefined)
    return bad(
      `item_reference "${item.id}" is not known to plugboard: it keeps the output of recent answers for an hour, per app. Send the earlier items in full, or send store: false (Vercel AI SDK: providerOptions.openai.store = false)`,
      `${param}.id`,
      "item_not_found",
    )
  return found
}

const parseInput = (input: unknown, resolve: ItemResolver | undefined): { system: string[]; messages: PlugMessage[] } | PlugError => {
  if (typeof input === "string") return { system: [], messages: [{ role: "user", content: [{ type: "text", text: input }] }] }
  if (!Array.isArray(input) || input.length === 0) return bad("input must be a string or a non-empty array of items", "input")

  const system: string[] = []
  const messages: PlugMessage[] = []
  const toolNames = new Map<string, string>()
  let pending: PlugPart[] | undefined
  const flush = () => {
    if (pending && pending.length > 0) messages.push({ role: "assistant", content: pending })
    pending = undefined
  }

  for (const [index, given] of input.entries()) {
    const param = `input[${index}]`
    if (!isRecord(given)) return bad("Each input item must be an object", param)
    const item = given.type === "item_reference" ? resolveReference(given, param, resolve) : given
    if (isPlugError(item)) return item
    const type = item.type ?? (item.role !== undefined ? "message" : undefined)
    switch (type) {
      case "message": {
        switch (item.role) {
          case "system":
          case "developer": {
            const value = textOf(item.content)
            if (value === undefined) return bad("System message content must be a string or text parts", `${param}.content`)
            if (value.length > 0) system.push(value)
            break
          }
          case "user": {
            flush()
            const parts = userParts(item.content, `${param}.content`)
            if (!Array.isArray(parts)) return parts
            messages.push({ role: "user", content: parts })
            break
          }
          case "assistant": {
            const text = assistantText(item.content, `${param}.content`)
            if (typeof text !== "string") return text
            if (text.length > 0) (pending ??= []).push({ type: "text", text })
            break
          }
          default:
            return bad(`Unsupported message role "${String(item.role)}"`, `${param}.role`)
        }
        break
      }
      case "function_call": {
        if (typeof item.call_id !== "string" || item.call_id.length === 0) return bad("function_call needs a non-empty call_id", `${param}.call_id`)
        if (typeof item.name !== "string" || item.name.length === 0) return bad("function_call needs a name", `${param}.name`)
        toolNames.set(item.call_id, item.name)
        ;(pending ??= []).push({
          type: "tool-call",
          id: item.call_id,
          name: item.name,
          input: typeof item.arguments === "string" ? parseJson(item.arguments) : (item.arguments ?? {}),
        })
        break
      }
      case "function_call_output": {
        flush()
        if (typeof item.call_id !== "string") return bad("function_call_output needs a call_id", `${param}.call_id`)
        const result = textOf(item.output)
        if (result === undefined) return bad("function_call_output output must be a string or an array of text parts", `${param}.output`)
        const name = toolNames.get(item.call_id)
        if (name === undefined)
          return bad(`function_call_output answers call_id "${item.call_id}", which no earlier function_call item has`, `${param}.call_id`)
        messages.push({ role: "tool", content: [{ type: "tool-result", id: item.call_id, name, result }] })
        break
      }
      // Reasoning items carry no content plugboard can replay; they are dropped.
      case "reasoning":
        break
      default:
        return unsupported(`Unsupported input item type "${String(type)}"`, `${param}.type`)
    }
  }
  flush()
  if (messages.length === 0) return bad("input has no user, assistant or tool items", "input")
  return { system, messages }
}

const parseTools = (raw: unknown): PlugTool[] | PlugError => {
  if (raw == null) return []
  if (!Array.isArray(raw)) return bad("tools must be an array", "tools")
  const tools: PlugTool[] = []
  const names = new Set<string>()
  for (const [index, entry] of raw.entries()) {
    const at = `tools[${index}]`
    if (!isRecord(entry)) return bad("Each tool must be an object", at)
    if (entry.type !== "function")
      return unsupported(`Unsupported tool type "${String(entry.type)}": only function tools are supported (built-in tools such as web_search and file_search run on OpenAI's servers)`, `${at}.type`)
    if (typeof entry.name !== "string" || entry.name.length === 0) return bad('Each function tool needs a "name"', `${at}.name`)
    if (names.has(entry.name)) return bad(`Duplicate tool name "${entry.name}"`, `${at}.name`)
    if (entry.description != null && typeof entry.description !== "string") return bad("Tool description must be a string", `${at}.description`)
    // `parameters` may be null (strict mode with no arguments): a tool without arguments.
    if (entry.parameters != null && !isRecord(entry.parameters)) return bad("Tool parameters must be a JSON Schema object", `${at}.parameters`)
    names.add(entry.name)
    tools.push({
      name: entry.name,
      description: typeof entry.description === "string" ? entry.description : "",
      parameters: isRecord(entry.parameters) ? entry.parameters : { type: "object", properties: {} },
    })
  }
  return tools
}

/**
 * A caller's tool as echoed on the response object. A function tool always carries `strict` (#289, the OpenAI
 * FunctionTool schema requires it): the caller's boolean, or false when it was absent or null. Other entries are
 * echoed as sent.
 */
const echoTool = (tool: unknown): unknown => (isRecord(tool) && tool.type === "function" ? { ...tool, strict: tool.strict === true } : tool)

const parseToolChoice = (raw: unknown): PlugToolChoice | undefined | PlugError => {
  if (raw == null) return undefined
  if (raw === "auto" || raw === "none" || raw === "required") return raw
  if (isRecord(raw) && raw.type === "function" && typeof raw.name === "string") return { type: "tool", name: raw.name }
  return unsupported("Unsupported tool_choice: use auto, none, required or {type:\"function\", name}", "tool_choice")
}

/**
 * `text.format`: `json_schema` -> the `respond` tool (`structured`, forced unless the caller also
 * sends tools); `json_object` -> a system instruction (`instruction`).
 */
const parseTextFormat = (raw: unknown): { structured?: PlugTool; instruction?: string } | PlugError => {
  if (raw == null) return {}
  if (!isRecord(raw)) return bad("text must be an object", "text")
  const format = raw.format
  if (format == null || (isRecord(format) && format.type === "text")) return {}
  if (!isRecord(format)) return bad("text.format must be an object", "text.format")
  if (format.type === "json_object") return { instruction: JSON_OBJECT_INSTRUCTION }
  if (format.type === "json_schema") {
    if (format.name != null && typeof format.name !== "string") return bad("text.format.name must be a string", "text.format.name")
    if (format.description != null && typeof format.description !== "string") return bad("text.format.description must be a string", "text.format.description")
    if (!isRecord(format.schema)) return bad("text.format.schema must be a JSON Schema object", "text.format.schema")
    return {
      structured: {
        name: RESPOND_TOOL,
        // With caller tools also on offer, this description is what tells the model which call is the final answer.
        description:
          "Give your final answer by calling this tool with JSON matching its schema." +
          (typeof format.description === "string" ? ` ${format.description}` : ""),
        parameters: format.schema,
      },
    }
  }
  return bad(`Unsupported text.format type "${String(format.type)}"`, "text.format.type")
}

const parseGeneration = (body: JsonObject): PlugGeneration | PlugError => {
  const out: { -readonly [K in keyof PlugGeneration]: PlugGeneration[K] } = {}
  for (const [key, field, min, max, integer] of [
    ["temperature", "temperature", 0, 2, false],
    ["top_p", "topP", 0, 1, false],
    ["max_output_tokens", "maxTokens", 1, Number.MAX_SAFE_INTEGER, true],
  ] as const) {
    const value = body[key]
    if (value == null) continue
    if (typeof value !== "number" || !Number.isFinite(value)) return bad(`${key} must be a number`, key)
    if (integer && !Number.isInteger(value)) return bad(`${key} must be an integer`, key)
    if (value < min || value > max)
      return bad(max === Number.MAX_SAFE_INTEGER ? `${key} must be at least ${min}` : `${key} must be between ${min} and ${max}`, key)
    out[field] = value
  }
  return out
}

/** Fields that need server-side state or features plugboard does not have. */
const checkUnsupported = (body: JsonObject): PlugError | undefined => {
  if (body.previous_response_id != null)
    return unsupported("previous_response_id is not supported: plugboard is stateless, send the full conversation in input", "previous_response_id")
  if (body.conversation != null) return unsupported("conversation is not supported: plugboard is stateless", "conversation")
  if (body.background === true) return unsupported("background mode is not supported", "background")
  if (body.prompt != null) return unsupported("Stored prompts (prompt) are not supported", "prompt")
  if (body.top_logprobs != null && body.top_logprobs !== 0) return unsupported("top_logprobs is not supported", "top_logprobs")
  if (body.truncation != null && body.truncation !== "disabled") return unsupported('Only truncation "disabled" is supported', "truncation")
}

export function parseResponsesRequest(body: unknown, options: PlugboardOptions, resolve?: ItemResolver): ParsedResponses | PlugError {
  if (!isRecord(body)) return bad("Request body must be a JSON object")
  if (typeof body.model !== "string" || body.model.length === 0) return bad("model is required", "model")
  if (body.input == null) return bad("input is required", "input")
  const refused = checkUnsupported(body)
  if (refused) return refused
  if (body.instructions != null && typeof body.instructions !== "string") return bad("instructions must be a string", "instructions")
  if (body.reasoning != null && !isRecord(body.reasoning)) return bad("reasoning must be an object", "reasoning")
  if (body.stream != null && typeof body.stream !== "boolean") return bad("stream must be a boolean", "stream")

  const parsed = parseInput(body.input, resolve)
  if (isPlugError(parsed)) return parsed
  const callerTools = parseTools(body.tools)
  if (!Array.isArray(callerTools)) return callerTools
  const toolChoice = parseToolChoice(body.tool_choice)
  if (isPlugError(toolChoice)) return toolChoice
  const format = parseTextFormat(body.text)
  if (isPlugError(format)) return format
  const respond = format.structured
  const generation = parseGeneration(body)
  if (isPlugError(generation)) return generation

  if (typeof toolChoice === "object" && !callerTools.some((tool) => tool.name === toolChoice.name))
    return bad(`tool_choice names "${toolChoice.name}", which is not in tools`, "tool_choice.name")
  if (respond && callerTools.some((tool) => tool.name === RESPOND_TOOL))
    return bad(
      `A tool named "${RESPOND_TOOL}" collides with text.format json_schema, which plugboard answers through that name`,
      "tools",
      "reserved_tool_name",
    )
  // json_schema + caller tools: the model may call a caller tool or `respond`, so `tool_choice` is
  // `required` (not forced to `respond`). `tool_choice: none` leaves only `respond`; naming a tool
  // contradicts a structured answer.
  if (respond && typeof toolChoice === "object")
    return unsupported("A tool_choice that names a tool cannot be combined with text.format json_schema", "tool_choice")
  const withCallerTools = respond !== undefined && callerTools.length > 0 && toolChoice !== "none"
  const tools = respond ? (withCallerTools ? [...callerTools, respond] : [respond]) : callerTools
  if (tools.length > options.maxTools)
    return bad(`Request has ${tools.length} tools; plugboard allows ${options.maxTools} (option \`maxTools\`)`, "tools", "too_many_tools")

  const forced: PlugToolChoice | undefined = respond ? (withCallerTools ? "required" : { type: "tool", name: RESPOND_TOOL }) : toolChoice
  const instructions = typeof body.instructions === "string" && body.instructions.length > 0 ? [body.instructions] : []
  const system = [...instructions, ...parsed.system, ...(format.instruction ? [format.instruction] : [])]
  const request: Omit<PlugRequest, "ref"> = {
    ...userField(bodyUser(body)),
    model: body.model,
    system,
    messages: parsed.messages,
    tools,
    ...(forced && tools.length > 0 ? { toolChoice: forced } : {}),
    ...(respond ? { structuredTool: RESPOND_TOOL } : {}),
    generation,
  }
  const reasoningEffort = isRecord(body.reasoning) && typeof body.reasoning.effort === "string" ? body.reasoning.effort : undefined
  const text = isRecord(body.text) ? body.text : undefined
  return {
    request,
    exchange: {
      model: body.model,
      stream: body.stream === true,
      // Echoed in the response object, as OpenAI does. `store` is always false: nothing is kept for retrieval.
      envelope: {
        instructions: typeof body.instructions === "string" ? body.instructions : null,
        max_output_tokens: generation.maxTokens ?? null,
        metadata: isRecord(body.metadata) ? body.metadata : {},
        parallel_tool_calls: body.parallel_tool_calls !== false,
        previous_response_id: null,
        reasoning: { effort: reasoningEffort ?? null, summary: null },
        store: false,
        temperature: generation.temperature ?? null,
        text: { format: isRecord(text?.format) ? text.format : { type: "text" } },
        tool_choice: body.tool_choice ?? "auto",
        tools: Array.isArray(body.tools) ? body.tools.map(echoTool) : [],
        top_p: generation.topP ?? null,
        truncation: "disabled",
        user: typeof body.user === "string" ? body.user : null,
      },
      ...(respond ? { structuredTool: RESPOND_TOOL, structuredSchema: respond.parameters, ...(withCallerTools ? { callerTools: true } : {}) } : {}),
    },
    ...(reasoningEffort ? { reasoningEffort } : {}),
  }
}
