/**
 * Legacy OpenAI `POST /v1/completions` request -> neutral `PlugRequest`s plus the
 * `CompletionsExchange` the encoders need.
 *
 * Pure function: no I/O. The OpenCode models are chat models, so a prompt becomes one user
 * message and there is no system prompt, except for `suffix` (see `SUFFIX_INSTRUCTION`). A string
 * prompt is one model call; a list of strings is one call per prompt, times `n` (capped by
 * `maxN`). The route resolves `model` to a `ModelRef` afterwards, which is why the requests omit
 * `ref`.
 */
import type { PlugboardOptions } from "../config.js"
import { isPlugError, type PlugError, type PlugRequest, type PlugToolChoice } from "../contract.js"
import { bodyUser, userField } from "../user.js"
import { RESPOND_TOOL, parseChoiceCount, parseGeneration, parseResponseFormat } from "../openai/request.js"
import type { CompletionsExchange } from "./response.js"

export interface ParsedCompletions {
  /** One model call per prompt, minus the model ref the route resolves from `model`. The route runs each `n` times. */
  readonly requests: ReadonlyArray<Omit<PlugRequest, "ref">>
  readonly n: number
  /** Response presentation state for the encoders; never reaches the model call. */
  readonly exchange: CompletionsExchange
  readonly reasoningEffort?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

const bad = (message: string, param?: string, code?: string): PlugError => ({
  status: 400,
  kind: "invalid_request",
  message,
  ...(code ? { code } : {}),
  ...(param ? { param } : {}),
})

const unsupported = (message: string, param: string) => bad(message, param, "unsupported_parameter")

/**
 * `suffix` is the text that should follow the completion (insert mode). Chat models have no
 * insert mode, so it is passed as an instruction: a best-effort mapping whose quality depends on
 * the model, and the only case that adds a system prompt.
 */
const SUFFIX_INSTRUCTION = (suffix: string) =>
  "Continue the user's text. Reply with only the text that belongs between the user's text and the following suffix, " +
  "so that the user's text, your reply and the suffix read as one passage. Do not repeat either of them and add no commentary.\n\nSuffix:\n" +
  suffix

/** `prompt`: a string, or a list of strings. Token ids (a list of numbers or of number lists) need a tokenizer and are rejected. */
const parsePrompts = (raw: unknown): string[] | PlugError => {
  if (typeof raw === "string") return [raw]
  if (!Array.isArray(raw) || raw.length === 0) return bad("prompt must be a string or a non-empty array of strings", "prompt")
  if (raw.some((item) => typeof item === "number" || Array.isArray(item)))
    return unsupported("Token-array prompts are not supported; send the prompt as text", "prompt")
  if (!raw.every((item) => typeof item === "string")) return bad("prompt must be a string or an array of strings", "prompt")
  return raw as string[]
}

export function parseCompletionsRequest(body: unknown, options: PlugboardOptions): ParsedCompletions | PlugError {
  if (!isRecord(body)) return bad("Request body must be a JSON object")
  if (typeof body.model !== "string" || body.model.length === 0) return bad("model is required", "model")
  if (body.prompt == null) return bad("prompt is required", "prompt")
  if (body.stream != null && typeof body.stream !== "boolean") return bad("stream must be a boolean", "stream")

  if (body.logprobs != null) return unsupported("logprobs is not supported", "logprobs")
  if (body.best_of != null) {
    if (typeof body.best_of !== "number" || !Number.isInteger(body.best_of) || body.best_of < 1) return bad("best_of must be a positive integer", "best_of")
    if (body.best_of > 1) return unsupported("best_of is not supported", "best_of")
  }
  if (body.echo != null && typeof body.echo !== "boolean") return bad("echo must be a boolean", "echo")
  if (body.suffix != null && typeof body.suffix !== "string") return bad("suffix must be a string", "suffix")

  const prompts = parsePrompts(body.prompt)
  if (isPlugError(prompts)) return prompts
  const n = parseChoiceCount(body, options)
  if (isPlugError(n)) return n
  if (prompts.length * n > options.maxN)
    return bad(
      `${prompts.length} prompt${prompts.length === 1 ? "" : "s"} with n=${n} make ${prompts.length * n} model calls, above the limit of ${options.maxN} (option \`maxN\`, or \`apps.<name>.maxN\` for this app)`,
      prompts.length > 1 ? "prompt" : "n",
      "too_many_choices",
    )
  const generation = parseGeneration(body)
  if (isPlugError(generation)) return generation
  // The same response_format as Chat Completions: json_schema is the forced `respond` tool, json_object an instruction.
  const format = parseResponseFormat(body.response_format)
  if (isPlugError(format)) return format

  const suffix = typeof body.suffix === "string" && body.suffix.length > 0 ? body.suffix : undefined
  const system = [...(suffix ? [SUFFIX_INSTRUCTION(suffix)] : []), ...(format.instruction ? [format.instruction] : [])]
  const tools = format.structured ? [format.structured] : []
  const toolChoice: PlugToolChoice | undefined = format.structured ? { type: "tool", name: RESPOND_TOOL } : undefined
  const streamOptions = isRecord(body.stream_options) ? body.stream_options : {}
  return {
    requests: prompts.map((prompt) => ({
      model: body.model as string,
      ...userField(bodyUser(body)),
      system,
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      tools,
      ...(toolChoice ? { toolChoice } : {}),
      ...(format.structured ? { structuredTool: RESPOND_TOOL } : {}),
      generation,
    })),
    n,
    exchange: {
      model: body.model,
      stream: body.stream === true,
      includeUsage: streamOptions.include_usage === true,
      perPrompt: n,
      ...(body.echo === true ? { echo: prompts } : {}),
      ...(generation.stop ? { stop: generation.stop } : {}),
      ...(format.structured ? { structuredTool: RESPOND_TOOL, structuredSchema: format.structured.parameters } : {}),
      ...(format.instruction ? { jsonObject: true } : {}),
    },
    ...(typeof body.reasoning_effort === "string" ? { reasoningEffort: body.reasoning_effort } : {}),
  }
}
