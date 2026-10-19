/**
 * OpenAI Responses request -> neutral `PlugRequest` plus the `ResponsesExchange` the response
 * encoder needs.
 *
 * Pure function: no I/O. The caller sends the whole conversation in `input` each time, which is
 * how history already works. An `item_reference` is resolved through the `resolve` argument (the
 * route passes the per-app store of recent answers, src/responses/store.ts; #147). A
 * `previous_response_id` is resolved by the route (src/responses/state.ts), which passes the stored
 * items as `history`. Anything else that needs server-side state (`conversation`, `background`) is rejected with
 * 400 `unsupported_parameter` naming the field. Tools: `function` tools pass; `namespace` and `custom` tools are flattened into
 * function tools (`parseTools`) and called back in the shape Codex parses (src/responses/response.ts); an `additional_tools`
 * input item is a tool list; hosted tools are left out and reported. The route resolves `model` to a
 * `ModelRef` afterwards, which is why the request omits `ref`.
 */
import { createHash } from "node:crypto"
import type { HostedTools, PlugboardOptions } from "../config.js"
import { show } from "../client-value.js"
import { imageProblem, pdfProblem } from "../image.js"
import { bodyUser, userField } from "../user.js"
import { isPlugError, type PlugError, type PlugGeneration, type PlugMessage, type PlugPart, type PlugRequest, type PlugTool, type PlugToolChoice } from "../contract.js"
import { FREEFORM_ARGUMENT, type ResponsesExchange, type ToolRoute } from "./response.js"

type JsonObject = Record<string, unknown>

export interface ParsedResponses {
  /** The model call, minus the model ref the route resolves from `request.model`. */
  readonly request: Omit<PlugRequest, "ref">
  /** The new `input` as items, with `item_reference`s replaced by the items they name (what a stored response keeps). */
  readonly inputItems: ReadonlyArray<JsonObject>
  /** Hosted tool types left out of the request (`x-plugboard-dropped-tools`). */
  readonly droppedTools: ReadonlyArray<string>
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
      if (typeof url !== "string") return unsupported(item.file_id != null ? "input_image.file_id is not supported (stateless); send image_url" : "input_image needs an image_url", `${at}.image_url`)
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
    } else return unsupported(`Unsupported content part type "${show(item.type)}"`, `${at}.type`)
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
      return unsupported(`Unsupported assistant content part type "${show(item.type)}"`, `${param}[${index}].type`)
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

/** A string `input` as the item list OpenAI treats it as: one user message. */
const userItem = (text: string): JsonObject => ({ type: "message", role: "user", content: [{ type: "input_text", text }] })

/**
 * The items of a stored response's chain (`history`: its input, then its output) and the new `input`, as neutral messages.
 * `resolved` is the new input with its `item_reference`s replaced by the items they name: with `history`, the input the
 * model saw (src/responses/state.ts).
 */
const parseInput = (
  input: unknown,
  resolve: ItemResolver | undefined,
  history: ReadonlyArray<JsonObject> = [],
): { system: string[]; messages: PlugMessage[]; resolved: JsonObject[]; toolSources: ToolSource[] } | PlugError => {
  const fresh = typeof input === "string" ? [userItem(input)] : input
  if (!Array.isArray(fresh) || fresh.length === 0) return bad("input must be a string or a non-empty array of items", "input")
  const resolved: JsonObject[] = []

  const system: string[] = []
  const messages: PlugMessage[] = []
  const toolNames = new Map<string, string>()
  const toolSources: ToolSource[] = []
  let pending: PlugPart[] | undefined
  const flush = () => {
    if (pending && pending.length > 0) messages.push({ role: "assistant", content: pending })
    pending = undefined
  }

  for (const [position, given] of [...history, ...fresh].entries()) {
    const index = position - history.length
    const param = `input[${index}]`
    if (!isRecord(given)) return bad("Each input item must be an object", param)
    const item = given.type === "item_reference" ? resolveReference(given, param, resolve) : given
    if (isPlugError(item)) return item
    if (index >= 0) resolved.push(item)
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
            return bad(`Unsupported message role "${show(item.role)}"`, `${param}.role`)
        }
        break
      }
      // A call in a namespace (`namespace` + the bare `name`, as Codex sends it back) is the flattened tool the model was offered (`flatName`).
      // A freeform call carries its raw text in `input`: the model gave it as the one argument of the function it saw.
      case "function_call":
      case "custom_tool_call": {
        if (typeof item.call_id !== "string" || item.call_id.length === 0) return bad(`${type} needs a non-empty call_id`, `${param}.call_id`)
        if (typeof item.name !== "string" || item.name.length === 0) return bad(`${type} needs a name`, `${param}.name`)
        if (item.namespace != null && typeof item.namespace !== "string") return bad(`${type} namespace must be a string`, `${param}.namespace`)
        const name = flatName(item.namespace ?? undefined, item.name)
        toolNames.set(item.call_id, name)
        ;(pending ??= []).push({
          type: "tool-call",
          id: item.call_id,
          name,
          input:
            type === "custom_tool_call"
              ? { [FREEFORM_ARGUMENT]: typeof item.input === "string" ? item.input : "" }
              : typeof item.arguments === "string"
                ? parseJson(item.arguments)
                : (item.arguments ?? {}),
        })
        break
      }
      // Codex declares its tools in an input item instead of `tools` for a model it knows (#498).
      case "additional_tools": {
        if (!Array.isArray(item.tools)) return bad("additional_tools needs a tools array", `${param}.tools`)
        toolSources.push({ raw: item.tools, param: `${param}.tools`, additional: true })
        break
      }
      case "function_call_output":
      case "custom_tool_call_output": {
        flush()
        if (typeof item.call_id !== "string") return bad(`${type} needs a call_id`, `${param}.call_id`)
        const result = textOf(item.output)
        if (result === undefined) return bad(`${type} output must be a string or an array of text parts`, `${param}.output`)
        const name = toolNames.get(item.call_id)
        if (name === undefined)
          return bad(`${type} answers call_id "${item.call_id}", which no earlier ${type === "custom_tool_call_output" ? "custom_tool_call" : "function_call"} item has`, `${param}.call_id`)
        messages.push({ role: "tool", content: [{ type: "tool-result", id: item.call_id, name, result }] })
        break
      }
      // Reasoning items carry no content plugboard can replay; they are dropped.
      case "reasoning":
        break
      default:
        return unsupported(`Unsupported input item type "${show(type)}"`, `${param}.type`)
    }
  }
  flush()
  if (messages.length === 0) return bad("input has no user, assistant or tool items", "input")
  return { system, messages, resolved, toolSources }
}

/** Where a list of tool declarations came from: the `tools` field, or an `additional_tools` input item (Codex, #498). */
interface ToolSource {
  readonly raw: unknown
  readonly param: string
  readonly additional: boolean
}

interface DeclaredTools {
  readonly tools: PlugTool[]
  /** Flattened names whose call goes back under another name, in a namespace, or as a custom tool call. */
  readonly routes: Map<string, ToolRoute>
  /** Hosted tool types that were left out. */
  readonly dropped: string[]
  /** The declared tools as the response object echoes them: the caller's own entries, hosted tools left out, `additional_tools` lists included. */
  readonly echo: unknown[]
}

/** The namespace Codex gives to top-level tools; a tool in it keeps its bare name. */
const DEFAULT_NAMESPACE = "functions"

/** The longest function name OpenAI and Anthropic take. */
const MAX_TOOL_NAME = 64
/** Hex characters of the hash that ends a shortened name. */
const NAME_HASH_LENGTH = 8

/**
 * Tool types that run on OpenAI's servers: nothing in plugboard can run them, and a client cannot know that, so next to function
 * tools they are left out and reported (`x-plugboard-dropped-tools`; app option `hostedTools`). Other types (`local_shell`,
 * `tool_search`, `computer_use_preview`, ...) need a client-side round trip plugboard has no shape for, and stay refused.
 */
const HOSTED_TOOLS = new Set(["web_search", "web_search_preview", "web_search_preview_2025_03_11", "file_search", "code_interpreter", "image_generation", "mcp"])

const isDefaultNamespace = (namespace: string | undefined): boolean => namespace === undefined || namespace === "" || namespace === DEFAULT_NAMESPACE

/**
 * The function name the model sees for a tool: the namespace and the name, joined by `__` (`mcp__weather__get_weather`). A name
 * over 64 characters (an MCP server name and a long tool name make one) is cut and ends in a hash of the namespace and the name, so
 * two long names stay apart and the same tool gets the same name in the offer, in a call and in the history.
 */
const flatName = (namespace: string | undefined, name: string): string => {
  const own = isDefaultNamespace(namespace)
  const full = own ? name : `${namespace}${namespace!.endsWith("__") ? "" : "__"}${name}`
  if (full.length <= MAX_TOOL_NAME) return full
  const hash = createHash("sha256")
    .update(`${own ? "" : namespace}\0${name}`)
    .digest("hex")
    .slice(0, NAME_HASH_LENGTH)
  return `${full.slice(0, MAX_TOOL_NAME - NAME_HASH_LENGTH - 1)}_${hash}`
}

/** A freeform tool as a function tool taking one string: its grammar, when it has one, goes into the description. */
const customTool = (name: string, entry: JsonObject): PlugTool => {
  const format = isRecord(entry.format) && entry.format.type === "grammar" && typeof entry.format.definition === "string" ? entry.format : undefined
  const syntax = typeof format?.syntax === "string" ? `${format.syntax} ` : ""
  const grammar = format ? `\n\nThe input must match this ${syntax}grammar:\n${format.definition}` : ""
  return {
    name,
    description: `${typeof entry.description === "string" ? entry.description : ""}\n\nThis is a freeform tool: pass its whole input as the "${FREEFORM_ARGUMENT}" string.${grammar}`.trim(),
    parameters: { type: "object", properties: { [FREEFORM_ARGUMENT]: { type: "string", description: "The raw input of the tool." } }, required: [FREEFORM_ARGUMENT], additionalProperties: false },
  }
}

/**
 * Tool declarations -> function tools. A `namespace` tool (Codex sends every MCP server's tools as one) is flattened into
 * one function per tool, named by `flatName`. A `custom` tool becomes a function with one string argument. `routes` records
 * how a call to each goes back to the client. Hosted tool types are dropped (`hosted: "drop"`, and only when function tools come
 * with them) or refused (`"refuse"`); any other type is refused. The names are the flat ones, so the duplicate, reserved-name and
 * `maxTools` checks count what the model gets. A name declared again by a later `additional_tools` item replaces the earlier
 * declaration, because Codex sends the list again with each turn and a description may change between turns; any other repeat is a duplicate.
 */
const parseTools = (sources: ReadonlyArray<ToolSource>, hosted: HostedTools): DeclaredTools | PlugError => {
  const tools: PlugTool[] = []
  const routes = new Map<string, ToolRoute>()
  const dropped: string[] = []
  let firstHosted: { type: string; at: string } | undefined
  /** The declarations in force, in the order of `tools`: the entry and the namespace it sat in, for the echo. */
  const slots: Array<{ namespace?: JsonObject; entry: JsonObject }> = []
  const seen = new Map<string, { index: number; source: number; additional: boolean }>()

  const add = (entry: JsonObject, at: string, namespace: JsonObject | undefined, source: number, additional: boolean): PlugError | undefined => {
    if (typeof entry.name !== "string" || entry.name.length === 0) return bad(`Each ${entry.type} tool needs a "name"`, `${at}.name`)
    const space = namespace?.name as string | undefined
    const name = flatName(space, entry.name)
    const known = seen.get(name)
    if (known && !(additional && known.additional && known.source !== source)) return bad(`Duplicate tool name "${name}"`, `${at}.name`)
    if (entry.description != null && typeof entry.description !== "string") return bad("Tool description must be a string", `${at}.description`)
    // `parameters` may be null (strict mode with no arguments): a tool without arguments.
    if (entry.parameters != null && !isRecord(entry.parameters)) return bad("Tool parameters must be a JSON Schema object", `${at}.parameters`)
    const custom = entry.type === "custom"
    const tool: PlugTool = custom
      ? customTool(name, entry)
      : {
          name,
          description: typeof entry.description === "string" ? entry.description : "",
          parameters: isRecord(entry.parameters) ? entry.parameters : { type: "object", properties: {} },
        }
    const slot = { ...(namespace ? { namespace } : {}), entry }
    if (known) {
      tools[known.index] = tool
      slots[known.index] = slot
      seen.set(name, { ...known, source })
      routes.delete(name)
    } else {
      seen.set(name, { index: tools.length, source, additional })
      tools.push(tool)
      slots.push(slot)
    }
    const target = isDefaultNamespace(space) ? undefined : space
    // A call goes back under its own name, in its namespace, as a custom call; a shortened name is restored the same way.
    if (custom || target !== undefined || name !== entry.name) routes.set(name, { name: entry.name, ...(target !== undefined ? { namespace: target } : {}), ...(custom ? { custom: true } : {}) })
    return undefined
  }

  for (const [source, { raw, param, additional }] of sources.entries()) {
    if (raw == null) continue
    if (!Array.isArray(raw)) return bad(`${param} must be an array`, param)
    for (const [index, entry] of raw.entries()) {
      const at = `${param}[${index}]`
      if (!isRecord(entry)) return bad("Each tool must be an object", at)
      if (entry.type === "function" || entry.type === "custom") {
        const problem = add(entry, at, undefined, source, additional)
        if (problem) return problem
      } else if (entry.type === "namespace") {
        if (typeof entry.name !== "string" || entry.name.length === 0) return bad('Each namespace tool needs a "name"', `${at}.name`)
        if (!Array.isArray(entry.tools)) return bad("A namespace tool needs a tools array", `${at}.tools`)
        for (const [position, inner] of entry.tools.entries()) {
          const innerAt = `${at}.tools[${position}]`
          if (!isRecord(inner)) return bad("Each tool must be an object", innerAt)
          if (inner.type !== "function" && inner.type !== "custom")
            return unsupported(`Unsupported tool type "${show(inner.type)}" in a namespace: only function and custom tools are supported`, `${innerAt}.type`)
          const problem = add(inner, innerAt, entry, source, additional)
          if (problem) return problem
        }
      } else if (typeof entry.type === "string" && HOSTED_TOOLS.has(entry.type)) {
        if (hosted === "refuse") return unsupported(`Unsupported tool type "${entry.type}": hosted tools run on OpenAI's servers, and this app refuses them (option \`hostedTools\`)`, `${at}.type`)
        firstHosted ??= { type: entry.type, at }
        if (!dropped.includes(entry.type)) dropped.push(entry.type)
      } else {
        return unsupported(
          `Unsupported tool type "${show(entry.type)}": plugboard takes function, namespace and custom tools, and leaves out hosted tools such as web_search and file_search (they run on OpenAI's servers)`,
          `${at}.type`,
        )
      }
    }
  }
  // A hosted tool is left out only because the function tools next to it can still be offered. With none, the request would run with a
  // tool list it did not ask for (or with `tool_choice: required` and nothing to call), so it is refused, as it was before.
  if (firstHosted && tools.length === 0) {
    return unsupported(
      `Unsupported tool type "${firstHosted.type}": hosted tools run on OpenAI's servers and plugboard has none. They are left out only when function tools are sent with them`,
      `${firstHosted.at}.type`,
    )
  }

  // The echo keeps the caller's shape: top-level tools as sent, and each namespace once, with the tools of it that are in force.
  const echo: unknown[] = []
  const groups = new Map<string, { group: JsonObject; tools: unknown[] }>()
  for (const { namespace, entry } of slots) {
    if (!namespace) echo.push(echoTool(entry))
    else {
      let found = groups.get(namespace.name as string)
      if (!found) {
        found = { group: { ...namespace }, tools: [] }
        found.group.tools = found.tools
        groups.set(namespace.name as string, found)
        echo.push(found.group)
      }
      found.tools.push(echoTool(entry))
    }
  }
  return { tools, routes, dropped, echo }
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
  if (isRecord(raw) && (raw.type === "function" || raw.type === "custom") && typeof raw.name === "string")
    return { type: "tool", name: flatName(typeof raw.namespace === "string" ? raw.namespace : undefined, raw.name) }
  return unsupported('Unsupported tool_choice: use auto, none, required or {type:"function", name}', "tool_choice")
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
        description: "Give your final answer by calling this tool with JSON matching its schema." + (typeof format.description === "string" ? ` ${format.description}` : ""),
        parameters: format.schema,
      },
    }
  }
  return bad(`Unsupported text.format type "${show(format.type)}"`, "text.format.type")
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
    if (value < min || value > max) return bad(max === Number.MAX_SAFE_INTEGER ? `${key} must be at least ${min}` : `${key} must be between ${min} and ${max}`, key)
    out[field] = value
  }
  return out
}

/** Fields that need server-side state or features plugboard does not have. */
const checkUnsupported = (body: JsonObject): PlugError | undefined => {
  if (body.conversation != null) return unsupported("conversation is not supported: continue a stored response with previous_response_id, or send the full conversation in input", "conversation")
  if (body.background === true) return unsupported("background mode is not supported", "background")
  if (body.prompt != null) return unsupported("Stored prompts (prompt) are not supported", "prompt")
  if (body.top_logprobs != null && body.top_logprobs !== 0) return unsupported("top_logprobs is not supported", "top_logprobs")
  if (body.truncation != null && body.truncation !== "disabled") return unsupported('Only truncation "disabled" is supported', "truncation")
}

/**
 * `history` is the stored response `previous_response_id` named: its input and output items, ahead of the new `input`.
 * The route looks it up (src/responses/state.ts); this decoder only checks the field's type. `instructions` are never carried over.
 * `hosted` is the app's `hostedTools` option: what happens to a hosted tool next to function tools.
 */
export function parseResponsesRequest(
  body: unknown,
  options: PlugboardOptions,
  resolve?: ItemResolver,
  history?: ReadonlyArray<JsonObject>,
  hosted: HostedTools = "drop",
): ParsedResponses | PlugError {
  if (!isRecord(body)) return bad("Request body must be a JSON object")
  if (typeof body.model !== "string" || body.model.length === 0) return bad("model is required", "model")
  if (body.input == null) return bad("input is required", "input")
  const refused = checkUnsupported(body)
  if (refused) return refused
  if (body.instructions != null && typeof body.instructions !== "string") return bad("instructions must be a string", "instructions")
  if (body.reasoning != null && !isRecord(body.reasoning)) return bad("reasoning must be an object", "reasoning")
  if (body.stream != null && typeof body.stream !== "boolean") return bad("stream must be a boolean", "stream")
  if (body.previous_response_id != null && (typeof body.previous_response_id !== "string" || body.previous_response_id.length === 0))
    return bad("previous_response_id must be the id of a response", "previous_response_id")

  const parsed = parseInput(body.input, resolve, history)
  if (isPlugError(parsed)) return parsed
  // `additional_tools` items are tool lists too: with one, `tools` may be absent (Codex sends it so for a model it knows, #498).
  const declared = parseTools([{ raw: body.tools, param: "tools", additional: false }, ...parsed.toolSources], hosted)
  if (isPlugError(declared)) return declared
  const callerTools = declared.tools
  const toolChoice = parseToolChoice(body.tool_choice)
  if (isPlugError(toolChoice)) return toolChoice
  const format = parseTextFormat(body.text)
  if (isPlugError(format)) return format
  const respond = format.structured
  const generation = parseGeneration(body)
  if (isPlugError(generation)) return generation

  if (typeof toolChoice === "object" && !callerTools.some((tool) => tool.name === toolChoice.name)) return bad(`tool_choice names "${toolChoice.name}", which is not in tools`, "tool_choice.name")
  if (respond && callerTools.some((tool) => tool.name === RESPOND_TOOL))
    return bad(`A tool named "${RESPOND_TOOL}" collides with text.format json_schema, which plugboard answers through that name`, "tools", "reserved_tool_name")
  // json_schema + caller tools: the model may call a caller tool or `respond`, so `tool_choice` is
  // `required` (not forced to `respond`). `tool_choice: none` leaves only `respond`; naming a tool
  // contradicts a structured answer.
  if (respond && typeof toolChoice === "object") return unsupported("A tool_choice that names a tool cannot be combined with text.format json_schema", "tool_choice")
  const withCallerTools = respond !== undefined && callerTools.length > 0 && toolChoice !== "none"
  const tools = respond ? (withCallerTools ? [...callerTools, respond] : [respond]) : callerTools
  if (tools.length > options.maxTools) return bad(`Request has ${tools.length} tools; plugboard allows ${options.maxTools} (option \`maxTools\`)`, "tools", "too_many_tools")

  const forced: PlugToolChoice | undefined = respond ? (withCallerTools ? "required" : { type: "tool", name: RESPOND_TOOL }) : toolChoice
  const instructions = typeof body.instructions === "string" && body.instructions.length > 0 ? [body.instructions] : []
  const system = [...instructions, ...parsed.system, ...(format.instruction ? [format.instruction] : [])]
  const request: Omit<PlugRequest, "ref"> = {
    ...userField(bodyUser(body)),
    model: body.model,
    system,
    messages: parsed.messages,
    tools,
    ...(forced && (tools.length > 0 || forced === "none") ? { toolChoice: forced } : {}),
    ...(respond ? { structuredTool: RESPOND_TOOL } : {}),
    generation,
    ...(body.parallel_tool_calls === false ? { parallelToolCalls: false } : {}),
  }
  const reasoningEffort = isRecord(body.reasoning) && typeof body.reasoning.effort === "string" ? body.reasoning.effort : undefined
  const text = isRecord(body.text) ? body.text : undefined
  return {
    request,
    inputItems: parsed.resolved,
    droppedTools: declared.dropped,
    exchange: {
      model: body.model,
      stream: body.stream === true,
      // Echoed in the response object as the caller sent it, true by default as OpenAI has it (#442). `store: false` keeps nothing for retrieval (#426, src/responses/route.ts).
      envelope: {
        instructions: typeof body.instructions === "string" ? body.instructions : null,
        max_output_tokens: generation.maxTokens ?? null,
        metadata: isRecord(body.metadata) ? body.metadata : {},
        parallel_tool_calls: body.parallel_tool_calls !== false,
        previous_response_id: typeof body.previous_response_id === "string" ? body.previous_response_id : null,
        reasoning: { effort: reasoningEffort ?? null, summary: null },
        store: body.store !== false,
        temperature: generation.temperature ?? null,
        text: { format: isRecord(text?.format) ? text.format : { type: "text" } },
        tool_choice: body.tool_choice ?? "auto",
        tools: declared.echo,
        top_p: generation.topP ?? null,
        truncation: "disabled",
        user: typeof body.user === "string" ? body.user : null,
      },
      ...(respond ? { structuredTool: RESPOND_TOOL, structuredSchema: respond.parameters, ...(withCallerTools ? { callerTools: true } : {}) } : {}),
      ...(declared.routes.size > 0 ? { toolRoutes: declared.routes } : {}),
    },
    ...(reasoningEffort ? { reasoningEffort } : {}),
  }
}
