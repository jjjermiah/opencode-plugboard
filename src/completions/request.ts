/**
 * Legacy OpenAI `POST /v1/completions` request -> neutral `PlugRequest`s plus the
 * `CompletionsExchange` the encoders need.
 *
 * Pure function: no I/O. The OpenCode models are chat models, so a prompt becomes one user
 * message and there is no system prompt, except for `suffix` (see `SUFFIX_INSTRUCTION`). A string
 * prompt is one model call; a list of strings is one call per prompt, times `n` (capped by
 * `maxChoices`). The route resolves `model` to a `ModelRef` afterwards, which is why the requests omit
 * `ref`.
 */
import { Schema, type SchemaIssue } from "effect"
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

/** One top-level check, failing with its PlugError `message` and `code`. The param is the field it sits on. */
const field = (message: string, valid: (value: unknown) => boolean, code?: string) => Schema.Unknown.check(Schema.makeFilter<unknown>(valid, { message, ...(code ? { code } : {}) }))

/**
 * The top-level checks of the legacy body, in the order they run: the first failure wins, as it did
 * when they were hand-written. `prompt`'s shape (string or list) is checked after this, by `parsePrompts`.
 */
const LegacyBody = Schema.Struct({
  model: field("model is required", (value) => typeof value === "string" && value.length > 0),
  prompt: field("prompt is required", (value) => value != null),
  stream: Schema.optionalKey(field("stream must be a boolean", (value) => value == null || typeof value === "boolean")),
  logprobs: Schema.optionalKey(field("logprobs is not supported", (value) => value == null, "unsupported_parameter")),
  best_of: Schema.optionalKey(
    Schema.Unknown.check(
      Schema.makeFilter<unknown>((value) => value == null || (typeof value === "number" && Number.isInteger(value) && value >= 1), {
        message: "best_of must be a positive integer",
      }),
      Schema.makeFilter<unknown>((value) => value == null || (value as number) <= 1, { message: "best_of is not supported", code: "unsupported_parameter" }),
    ),
  ),
  echo: Schema.optionalKey(field("echo must be a boolean", (value) => value == null || typeof value === "boolean")),
  suffix: Schema.optionalKey(field("suffix must be a string", (value) => value == null || typeof value === "string")),
})

/** The failing check of `LegacyBody` as the PlugError it fails with (`param` is the field, from the pointer). */
const failureOf = (issue: SchemaIssue.Issue, param?: string): PlugError => {
  if (issue._tag === "Composite") return failureOf(issue.issues[0], param)
  if (issue._tag === "Pointer") return failureOf(issue.issue, String(issue.path[0]))
  // A required field that is absent: `model` and `prompt` are the only required keys.
  if (issue._tag === "MissingKey") return bad(`${param} is required`, param)
  if (issue._tag !== "Filter") throw new Error(`LegacyBody: unexpected issue ${issue._tag}`)
  const { message, code } = issue.filter.annotations as { message: string; code?: string }
  return bad(message, param, code)
}

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
  if (raw.some((item) => typeof item === "number" || Array.isArray(item))) return unsupported("Token-array prompts are not supported; send the prompt as text", "prompt")
  if (!raw.every((item) => typeof item === "string")) return bad("prompt must be a string or an array of strings", "prompt")
  return raw as string[]
}

export function parseCompletionsRequest(body: unknown, options: PlugboardOptions, capOption = "maxChoices"): ParsedCompletions | PlugError {
  if (!isRecord(body)) return bad("Request body must be a JSON object")
  const checked = Schema.decodeUnknownResult(LegacyBody)(body)
  if (checked._tag === "Failure") return failureOf(checked.failure.issue)

  const prompts = parsePrompts(body.prompt)
  if (isPlugError(prompts)) return prompts
  const n = parseChoiceCount(body, options, capOption)
  if (isPlugError(n)) return n
  if (prompts.length * n > options.maxChoices)
    return bad(
      `${prompts.length} prompt${prompts.length === 1 ? "" : "s"} with n=${n} make ${prompts.length * n} model calls, above the limit of ${options.maxChoices} (option \`${capOption}\`)`,
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
      model: body.model as string,
      stream: body.stream === true,
      includeUsage: streamOptions.include_usage === true,
      perPrompt: n,
      ...(body.echo === true ? { echo: prompts } : {}),
      ...(format.structured ? { structuredTool: RESPOND_TOOL, structuredSchema: format.structured.parameters } : {}),
      ...(format.instruction ? { jsonObject: true } : {}),
    },
    ...(typeof body.reasoning_effort === "string" ? { reasoningEffort: body.reasoning_effort } : {}),
  }
}
