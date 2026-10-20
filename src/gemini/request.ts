/**
 * Gemini `generateContent` / `streamGenerateContent` request -> neutral `PlugRequest` plus the
 * `GeminiExchange` the response encoder needs.
 *
 * Pure function: no I/O. The model and the stream flag come from the URL, the rest from the body.
 * Stateless like the other front-ends: the caller sends the whole conversation in `contents`.
 * Gemini function calls carry no id, so calls get generated ids (`call_0`, `call_1`, ...) and a
 * `functionResponse` is paired with the earliest unanswered call of the same name (or with the
 * call that has its `id`, when the client sends one). Hosted tools (`googleSearch`,
 * `codeExecution`, ...) and server-side state (`cachedContent`) are rejected with a 400.
 *
 * Field names are read in camelCase, the form every SDK sends, and in snake_case, which the REST
 * API also accepts.
 */
import type { PlugboardOptions } from "../config.js"
import { show } from "../client-value.js"
import { imageProblem } from "../image.js"
import { isPlugError, type PlugError, type PlugGeneration, type PlugMessage, type PlugPart, type PlugRequest, type PlugTool, type PlugToolChoice } from "../contract.js"
import type { GeminiExchange } from "./response.js"

type JsonObject = Record<string, unknown>

export interface ParsedGemini {
  /** The model call, minus the model ref the route resolves from `request.model`. */
  readonly request: Omit<PlugRequest, "ref">
  /** Response presentation state for the encoder; never reaches the model call. */
  readonly exchange: GeminiExchange
  /** `generationConfig.candidateCount` (1..`maxChoices`): the route fans out into one model call per candidate when it is above 1. */
  readonly candidates: number
  /** From `generationConfig.thinkingConfig`: picks the model variant of that name, else the nearest one above it (`effortVariant`, #410). */
  readonly reasoningEffort?: string
}

/** Name of the forced tool that carries structured output (same as the other front-ends). */
const RESPOND_TOOL = "respond"
/** Property that carries a non-object structured answer (an array or a scalar) through the object-only `respond` tool. */
export const WRAP_KEY = "value"

/** System instruction for `responseMimeType: application/json` without a schema. */
const JSON_OBJECT_INSTRUCTION = "Respond with a single valid JSON object only."

const MAX_STOP = 5

const isRecord = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value)

const bad = (message: string, param?: string, code?: string): PlugError => ({
  status: 400,
  kind: "invalid_request",
  message,
  ...(code ? { code } : {}),
  ...(param ? { param } : {}),
})

const unsupported = (message: string, param: string) => bad(message, param, "unsupported_parameter")

const snake = (name: string) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)

/** A field in camelCase, or snake_case when only that is present. */
const field = (object: JsonObject, name: string): unknown => object[name] ?? object[snake(name)]

// ---------------------------------------------------------------- schemas

/** `format` values that mean the same in JSON Schema; the rest (`int32`, `float`, `enum`, ...) are Gemini-only. */
const JSON_SCHEMA_FORMATS = new Set(["date-time", "date", "time", "email", "uri", "uuid", "hostname", "ipv4", "ipv6"])
/** Gemini types int64 limits as strings. */
const NUMERIC_STRING_KEYS = new Set(["minItems", "maxItems", "minLength", "maxLength", "minProperties", "maxProperties"])
const COPIED_KEYS = new Set(["description", "title", "enum", "required", "pattern", "default", "minimum", "maximum"])

/**
 * Gemini `Schema` (the OpenAPI subset of `parameters` and `responseSchema`) -> JSON Schema:
 * `OBJECT` becomes `object`, `nullable` becomes a `null` type, int64 strings become numbers, and
 * keys JSON Schema does not have (`example`, `propertyOrdering`, Gemini-only formats) are dropped.
 */
export function convertSchema(schema: unknown): unknown {
  if (!isRecord(schema)) return schema
  const out: JsonObject = {}
  for (const [key, value] of Object.entries(schema)) {
    if (key === "type") {
      if (typeof value === "string") {
        const type = value.toLowerCase()
        if (type !== "type_unspecified") out.type = type
      }
    } else if (key === "format") {
      if (typeof value === "string" && JSON_SCHEMA_FORMATS.has(value)) out.format = value
    } else if (key === "properties") {
      if (isRecord(value)) out.properties = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, convertSchema(child)]))
    } else if (key === "items") {
      out.items = convertSchema(value)
    } else if (key === "anyOf") {
      if (Array.isArray(value)) out.anyOf = value.map(convertSchema)
    } else if (key === "additionalProperties") {
      out.additionalProperties = typeof value === "boolean" ? value : convertSchema(value)
    } else if (NUMERIC_STRING_KEYS.has(key)) {
      const n = typeof value === "string" ? Number(value) : value
      if (typeof n === "number" && Number.isFinite(n)) out[key] = n
    } else if (COPIED_KEYS.has(key)) {
      out[key] = value
    }
  }
  if (schema.nullable === true && typeof out.type === "string") out.type = [out.type, "null"]
  return out
}

/** The parameters of a function declaration as a JSON Schema object (a tool with none takes no arguments). */
const toolParameters = (declaration: JsonObject): JsonObject | undefined => {
  const json = field(declaration, "parametersJsonSchema")
  if (isRecord(json)) return json
  const schema = convertSchema(declaration.parameters)
  if (!isRecord(schema)) return undefined
  return schema.type === undefined || schema.type === "object" ? { type: "object", properties: {}, ...schema } : schema
}

// ---------------------------------------------------------------- contents

const dataUrl = (mimeType: string, data: string) => `data:${mimeType};base64,${data}`

/**
 * URL-safe base64 (`-` and `_`, which the google-genai Python SDK sends for bytes) -> standard base64 (`+` and `/`),
 * padded when the input has no padding. Anything else is left as is for the base64 check to reject.
 */
const standardBase64 = (data: string): string => {
  const standard = data.replace(/-/g, "+").replace(/_/g, "/")
  return data.includes("=") ? standard : standard + "=".repeat((4 - (standard.length % 4)) % 4)
}

const textOf = (value: unknown, param: string): string | PlugError => {
  if (typeof value === "string") return value
  if (!isRecord(value)) return bad("Expected a string or a content object with text parts", param)
  if (typeof value.text === "string") return value.text
  const parts = value.parts
  if (!Array.isArray(parts)) return bad("Content needs a parts array", `${param}.parts`)
  const texts: string[] = []
  for (const [index, part] of parts.entries()) {
    if (!isRecord(part) || typeof part.text !== "string") return unsupported("Only text parts are supported here", `${param}.parts[${index}]`)
    texts.push(part.text)
  }
  return texts.join("\n")
}

/** `a` then `b`, with the text parts at the seam merged. */
const joinParts = (a: ReadonlyArray<PlugPart>, b: ReadonlyArray<PlugPart>): PlugPart[] => {
  const tail = a.at(-1)
  const head = b[0]
  if (tail?.type === "text" && head?.type === "text") return [...a.slice(0, -1), { type: "text", text: tail.text + head.text }, ...b.slice(1)]
  return [...a, ...b]
}

interface Call {
  readonly id: string
  readonly name: string
  answered: boolean
}

/**
 * `contents` -> neutral messages. A model turn is one assistant message (text and calls). A user
 * turn is one tool message per `functionResponse` (first, so each directly follows the calls it
 * answers) and then one user message with the rest.
 */
const parseContents = (raw: unknown): PlugMessage[] | PlugError => {
  if (!Array.isArray(raw) || raw.length === 0) return bad("contents must be a non-empty array", "contents")
  const messages: PlugMessage[] = []
  const calls: Call[] = []
  const used = new Set<string>()
  let counter = 0
  const nextId = () => {
    while (used.has(`call_${counter}`)) counter++
    return `call_${counter}`
  }

  for (const [index, content] of raw.entries()) {
    const param = `contents[${index}]`
    if (!isRecord(content)) return bad("Each content must be an object", param)
    const role = content.role ?? "user"
    // A non-string role is named by its type: String() on an object whose toString is not callable throws (#130 property run).
    if (role !== "user" && role !== "model" && role !== "function") return bad(`Unsupported role "${typeof role === "string" ? role : typeof role}": use "user" or "model"`, `${param}.role`)
    if (!Array.isArray(content.parts)) return bad("Each content needs a parts array", `${param}.parts`)

    const parts: PlugPart[] = []
    const results: PlugMessage[] = []
    for (const [p, part] of content.parts.entries()) {
      const at = `${param}.parts[${p}]`
      if (!isRecord(part)) return bad("Each part must be an object", at)
      const call = field(part, "functionCall")
      const response = field(part, "functionResponse")
      const inline = field(part, "inlineData")
      const file = field(part, "fileData")
      if (typeof part.text === "string") {
        // Thought summaries from an earlier turn are not replayable context.
        if (part.thought !== true && part.text.length > 0) parts.push({ type: "text", text: part.text })
      } else if (call !== undefined) {
        if (role !== "model") return bad("functionCall parts belong in a model turn", `${at}.functionCall`)
        if (!isRecord(call) || typeof call.name !== "string" || call.name.length === 0) return bad("functionCall needs a name", `${at}.functionCall.name`)
        const args = call.args ?? {}
        if (!isRecord(args)) return bad("functionCall args must be an object", `${at}.functionCall.args`)
        const id = typeof call.id === "string" && call.id.length > 0 && !used.has(call.id) ? call.id : nextId()
        used.add(id)
        calls.push({ id, name: call.name, answered: false })
        parts.push({ type: "tool-call", id, name: call.name, input: args })
      } else if (response !== undefined) {
        if (role === "model") return bad("functionResponse parts belong in a user turn", `${at}.functionResponse`)
        if (!isRecord(response) || typeof response.name !== "string" || response.name.length === 0) return bad("functionResponse needs a name", `${at}.functionResponse.name`)
        const wanted = typeof response.id === "string" ? response.id : undefined
        const match = (wanted !== undefined ? calls.find((c) => !c.answered && c.id === wanted) : undefined) ?? calls.find((c) => !c.answered && c.name === response.name)
        if (!match) return bad(`functionResponse "${response.name}" answers no earlier functionCall of that name (calls are paired by name and order)`, `${at}.functionResponse`)
        match.answered = true
        const body = response.response ?? {}
        // The convention is {output: ...} for a result and {error: ...} for a failure.
        const failed = isRecord(body) && body.error !== undefined && body.output === undefined
        results.push({
          role: "tool",
          content: [{ type: "tool-result", id: match.id, name: match.name, result: JSON.stringify(body), ...(failed ? { isError: true } : {}) }],
        })
      } else if (inline !== undefined) {
        if (role === "model") return unsupported("inlineData is not supported in a model turn", `${at}.inlineData`)
        const mimeType = isRecord(inline) ? field(inline, "mimeType") : undefined
        if (!isRecord(inline) || typeof inline.data !== "string" || typeof mimeType !== "string") return bad("inlineData needs mimeType and base64 data", `${at}.inlineData`)
        const url = dataUrl(mimeType, standardBase64(inline.data))
        const problem = mimeType.toLowerCase().startsWith("image/") ? imageProblem(url) : undefined
        if (problem) return bad(problem, `${at}.inlineData`, "invalid_image")
        parts.push({ type: "media", url, mediaType: mimeType })
      } else if (file !== undefined) {
        if (role === "model") return unsupported("fileData is not supported in a model turn", `${at}.fileData`)
        const uri = isRecord(file) ? field(file, "fileUri") : undefined
        if (typeof uri !== "string" || !/^https?:\/\//i.test(uri))
          return unsupported(
            "fileData needs an http(s) fileUri or a plugboard file (files/<id>, or the uri of an upload to /upload/v1beta/files); gs:// URIs and other Gemini file ids are not supported (send inlineData)",
            `${at}.fileData.fileUri`,
          )
        const mimeType = isRecord(file) ? field(file, "mimeType") : undefined
        parts.push({ type: "media", url: uri, ...(typeof mimeType === "string" ? { mediaType: mimeType } : {}) })
      } else if (isRecord(part) && Object.keys(part).every((key) => key === "thoughtSignature" || key === "thought_signature" || key === "thought")) {
        // A signature-only or empty part carries nothing to replay.
      } else {
        const kind = Object.keys(part).find((key) => key !== "thoughtSignature" && key !== "thought_signature" && key !== "thought") ?? "unknown"
        return unsupported(`Unsupported part "${kind}": plugboard handles text, inlineData, fileData (http), functionCall and functionResponse`, at)
      }
    }
    if (role === "model") {
      // A streamed turn replayed by an SDK arrives as one model content per chunk: they are one assistant message.
      const last = messages.at(-1)
      if (parts.length > 0 && last?.role === "assistant") messages[messages.length - 1] = { role: "assistant", content: joinParts(last.content, parts) }
      else if (parts.length > 0) messages.push({ role: "assistant", content: parts })
    } else {
      messages.push(...results)
      if (parts.length > 0) messages.push({ role: "user", content: parts })
    }
  }
  const open = calls.find((call) => !call.answered)
  if (open) return bad(`functionCall "${open.name}" has no functionResponse; send one for every call in the conversation`, "contents")
  if (messages.length === 0) return bad("contents has no text, media or tool parts", "contents")
  return messages
}

// ---------------------------------------------------------------- tools

/** Tool types that run on Google's side; plugboard only hands function calls back to the caller. */
const HOSTED = ["googleSearch", "googleSearchRetrieval", "codeExecution", "urlContext", "retrieval", "fileSearch", "googleMaps", "computerUse", "mcpServers", "enterpriseWebSearch"]

const parseTools = (raw: unknown): PlugTool[] | PlugError => {
  if (raw == null) return []
  if (!Array.isArray(raw)) return bad("tools must be an array", "tools")
  const tools: PlugTool[] = []
  const names = new Set<string>()
  for (const [index, entry] of raw.entries()) {
    const at = `tools[${index}]`
    if (!isRecord(entry)) return bad("Each tool must be an object", at)
    const hosted = HOSTED.find((key) => field(entry, key) !== undefined)
    if (hosted) return unsupported(`Unsupported tool "${hosted}": only functionDeclarations are supported (Google's built-in tools run on Google's servers)`, `${at}.${hosted}`)
    const declarations = field(entry, "functionDeclarations")
    if (declarations === undefined) {
      const other = Object.keys(entry)[0]
      if (other !== undefined) return unsupported(`Unsupported tool "${other}": only functionDeclarations are supported`, `${at}.${other}`)
      continue
    }
    if (!Array.isArray(declarations)) return bad("functionDeclarations must be an array", `${at}.functionDeclarations`)
    for (const [i, declaration] of declarations.entries()) {
      const param = `${at}.functionDeclarations[${i}]`
      if (!isRecord(declaration) || typeof declaration.name !== "string" || declaration.name.length === 0) return bad('Each function declaration needs a "name"', `${param}.name`)
      if (names.has(declaration.name)) return bad(`Duplicate tool name "${declaration.name}"`, `${param}.name`)
      if (declaration.description != null && typeof declaration.description !== "string") return bad("Tool description must be a string", `${param}.description`)
      names.add(declaration.name)
      tools.push({
        name: declaration.name,
        description: typeof declaration.description === "string" ? declaration.description : "",
        parameters: toolParameters(declaration) ?? { type: "object", properties: {} },
      })
    }
  }
  return tools
}

/**
 * `toolConfig.functionCallingConfig`: AUTO -> auto, NONE -> none, ANY -> required, and
 * `allowedFunctionNames` narrows the tools offered (one name with ANY forces that tool).
 */
const parseToolConfig = (raw: unknown, tools: PlugTool[]): { tools: PlugTool[]; toolChoice?: PlugToolChoice } | PlugError => {
  if (raw == null) return { tools }
  if (!isRecord(raw)) return bad("toolConfig must be an object", "toolConfig")
  const config = field(raw, "functionCallingConfig")
  if (config == null) return { tools }
  if (!isRecord(config)) return bad("functionCallingConfig must be an object", "toolConfig.functionCallingConfig")
  const mode = config.mode == null ? "AUTO" : typeof config.mode === "string" ? config.mode.toUpperCase() : undefined
  if (mode === undefined || !["AUTO", "ANY", "NONE", "VALIDATED", "MODE_UNSPECIFIED"].includes(mode))
    return bad(`Unsupported functionCallingConfig mode "${show(config.mode)}": use AUTO, ANY or NONE`, "toolConfig.functionCallingConfig.mode")
  const allowed = field(config, "allowedFunctionNames")
  if (allowed != null && (!Array.isArray(allowed) || !allowed.every((name) => typeof name === "string")))
    return bad("allowedFunctionNames must be an array of strings", "toolConfig.functionCallingConfig.allowedFunctionNames")
  let offered = tools
  if (Array.isArray(allowed) && allowed.length > 0 && mode !== "NONE") {
    const missing = allowed.find((name) => !tools.some((tool) => tool.name === name))
    if (missing !== undefined) return bad(`allowedFunctionNames names "${missing}", which is not in tools`, "toolConfig.functionCallingConfig.allowedFunctionNames")
    offered = tools.filter((tool) => allowed.includes(tool.name))
  }
  if (mode === "NONE") return { tools, toolChoice: "none" }
  if (mode === "ANY") {
    if (offered.length === 1 && Array.isArray(allowed) && allowed.length > 0) return { tools: offered, toolChoice: { type: "tool", name: offered[0]!.name } }
    return { tools: offered, toolChoice: "required" }
  }
  return { tools: offered, toolChoice: "auto" }
}

// ---------------------------------------------------------------- generation

/** `thinkingConfig` -> the variant name to try: `thinkingLevel` as is, or a `thinkingBudget` bucketed into none/low/medium/high. */
const effortOf = (config: unknown): string | undefined => {
  if (!isRecord(config)) return undefined
  const level = field(config, "thinkingLevel")
  if (typeof level === "string" && level.length > 0 && level.toUpperCase() !== "THINKING_LEVEL_UNSPECIFIED") return level.toLowerCase()
  const budget = field(config, "thinkingBudget")
  if (typeof budget !== "number" || !Number.isFinite(budget) || budget < 0) return undefined
  return budget === 0 ? "none" : budget <= 1024 ? "low" : budget <= 8192 ? "medium" : "high"
}

const parseGeneration = (config: JsonObject): PlugGeneration | PlugError => {
  const out: { -readonly [K in keyof PlugGeneration]: PlugGeneration[K] } = {}
  for (const [key, to, min, max, integer] of [
    ["temperature", "temperature", 0, 2, false],
    ["topP", "topP", 0, 1, false],
    ["presencePenalty", "presencePenalty", -2, 2, false],
    ["frequencyPenalty", "frequencyPenalty", -2, 2, false],
    ["topK", "topK", 0, Number.MAX_SAFE_INTEGER, true],
    ["seed", "seed", Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, true],
    ["maxOutputTokens", "maxTokens", 1, Number.MAX_SAFE_INTEGER, true],
  ] as const) {
    const value = field(config, key)
    if (value == null) continue
    const param = `generationConfig.${key}`
    if (typeof value !== "number" || !Number.isFinite(value)) return bad(`${key} must be a number`, param)
    if (integer && !Number.isInteger(value)) return bad(`${key} must be an integer`, param)
    if (value < min || value > max) return bad(max === Number.MAX_SAFE_INTEGER ? `${key} must be at least ${min}` : `${key} must be between ${min} and ${max}`, param)
    out[to] = value
  }
  const stop = field(config, "stopSequences")
  if (stop != null) {
    if (!Array.isArray(stop) || !stop.every((s) => typeof s === "string")) return bad("stopSequences must be an array of strings", "generationConfig.stopSequences")
    if (stop.some((s) => s.length === 0)) return bad("stopSequences must not contain an empty string", "generationConfig.stopSequences")
    if (stop.length > MAX_STOP) return bad(`stopSequences takes at most ${MAX_STOP} sequences`, "generationConfig.stopSequences")
    if (stop.length > 0) out.stop = stop as string[]
  }
  return out
}

/** `responseMimeType` / `responseSchema` / `responseJsonSchema`: same outcomes as `response_format` in the other front-ends. */
const parseResponseFormat = (config: JsonObject): { structured?: PlugTool; schema?: JsonObject; wrap?: boolean; instruction?: string } | PlugError => {
  const mime = field(config, "responseMimeType")
  const schema = field(config, "responseJsonSchema") ?? field(config, "responseSchema")
  if (mime != null && typeof mime !== "string") return bad("responseMimeType must be a string", "generationConfig.responseMimeType")
  if (mime !== undefined && mime !== null && mime !== "" && mime !== "text/plain" && mime !== "application/json")
    return unsupported(`Unsupported responseMimeType "${mime}": use application/json or text/plain`, "generationConfig.responseMimeType")
  if (schema == null) return mime === "application/json" ? { instruction: JSON_OBJECT_INSTRUCTION } : {}
  if (!isRecord(schema)) return bad("responseSchema must be a schema object", "generationConfig.responseSchema")
  const converted = field(config, "responseJsonSchema") !== undefined ? schema : (convertSchema(schema) as JsonObject)
  // The `respond` tool takes an object; an array or scalar answer travels under one property and is unwrapped.
  const wrap = converted.type !== undefined && converted.type !== "object"
  return {
    wrap,
    schema: converted,
    structured: {
      name: RESPOND_TOOL,
      description: "Give your final answer by calling this tool with JSON matching its schema.",
      parameters: wrap ? { type: "object", properties: { [WRAP_KEY]: converted }, required: [WRAP_KEY] } : converted,
    },
  }
}

/** Fields that need server-side state or features plugboard does not have. */
const checkUnsupported = (body: JsonObject, config: JsonObject): PlugError | undefined => {
  if (field(body, "cachedContent") != null) return unsupported("cachedContent is not supported: plugboard is stateless, send the full contents", "cachedContent")
  if (field(config, "responseLogprobs") === true) return unsupported("responseLogprobs is not supported", "generationConfig.responseLogprobs")
  const modalities = field(config, "responseModalities")
  if (Array.isArray(modalities) && modalities.some((m) => show(m).toUpperCase() !== "TEXT")) return unsupported("Only the TEXT response modality is supported", "generationConfig.responseModalities")
}

/** `candidateCount` is how many candidates to return. Each one is a full model call (see `src/openai/fanout.ts`), so it is capped by `maxChoices`, like `n`. */
const parseCandidateCount = (config: JsonObject, options: PlugboardOptions, capOption: string): number | PlugError => {
  const count = field(config, "candidateCount")
  if (count == null) return 1
  const param = "generationConfig.candidateCount"
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1) return bad("candidateCount must be a positive integer", param)
  if (count > options.maxChoices)
    return bad(`candidateCount=${count} is above the limit of ${options.maxChoices} (option \`${capOption}\`; each candidate is a full model call)`, param, "too_many_choices")
  return count
}

/** `capOption` names the option that set `options.maxChoices` in the 400 message (`maxChoices`, or `apps.<name>.maxChoices`). */
export function parseGeminiRequest(model: string, stream: boolean, body: unknown, options: PlugboardOptions, capOption = "maxChoices"): ParsedGemini | PlugError {
  if (!isRecord(body)) return bad("Request body must be a JSON object")
  const configRaw = field(body, "generationConfig")
  if (configRaw != null && !isRecord(configRaw)) return bad("generationConfig must be an object", "generationConfig")
  const config = isRecord(configRaw) ? configRaw : {}
  const refused = checkUnsupported(body, config)
  if (refused) return refused
  const candidates = parseCandidateCount(config, options, capOption)
  if (isPlugError(candidates)) return candidates

  const messages = parseContents(body.contents)
  if (isPlugError(messages)) return messages
  const instruction = field(body, "systemInstruction")
  const system = instruction == null ? "" : textOf(instruction, "systemInstruction")
  if (isPlugError(system)) return system
  const declared = parseTools(body.tools)
  if (!Array.isArray(declared)) return declared
  const configured = parseToolConfig(field(body, "toolConfig"), declared)
  if (isPlugError(configured)) return configured
  const format = parseResponseFormat(config)
  if (isPlugError(format)) return format
  const generation = parseGeneration(config)
  if (isPlugError(generation)) return generation

  const callerTools = configured.tools
  const toolChoice = configured.toolChoice
  const respond = format.structured
  if (respond && callerTools.some((tool) => tool.name === RESPOND_TOOL))
    return bad(`A tool named "${RESPOND_TOOL}" collides with responseSchema, which plugboard answers through that name`, "tools", "reserved_tool_name")
  if (respond && typeof toolChoice === "object") return unsupported("Mode ANY with a single allowed function cannot be combined with responseSchema", "toolConfig.functionCallingConfig")
  // Same rule as the other front-ends: with caller tools on offer the model may call one of them or
  // `respond`, so the choice is `required`; mode NONE leaves only `respond`.
  const withCallerTools = respond !== undefined && callerTools.length > 0 && toolChoice !== "none"
  const tools = respond ? (withCallerTools ? [...callerTools, respond] : [respond]) : callerTools
  if (tools.length > options.maxTools) return bad(`Request has ${tools.length} tools; plugboard allows ${options.maxTools} (option \`maxTools\`)`, "tools", "too_many_tools")
  const forced: PlugToolChoice | undefined = respond ? (withCallerTools ? "required" : { type: "tool", name: RESPOND_TOOL }) : toolChoice

  const request: Omit<PlugRequest, "ref"> = {
    model,
    system: [...(system.length > 0 ? [system] : []), ...(format.instruction ? [format.instruction] : [])],
    messages,
    tools,
    ...(forced && (tools.length > 0 || forced === "none") ? { toolChoice: forced } : {}),
    ...(respond ? { structuredTool: RESPOND_TOOL } : {}),
    generation,
  }
  const reasoningEffort = effortOf(field(config, "thinkingConfig"))
  return {
    request,
    candidates,
    exchange: {
      model,
      stream,
      ...(respond
        ? { structuredTool: RESPOND_TOOL, ...(format.schema ? { structuredSchema: format.schema } : {}), ...(format.wrap ? { wrapped: true } : {}), ...(withCallerTools ? { callerTools: true } : {}) }
        : {}),
      ...(format.instruction ? { jsonObject: true } : {}),
    },
    ...(reasoningEffort ? { reasoningEffort } : {}),
  }
}
