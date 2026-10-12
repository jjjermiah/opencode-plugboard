/**
 * Token counts for `count_tokens` (Anthropic #143) and `countTokens` (Gemini #144).
 *
 * plugboard has no tokenizer, and the host does not expose the provider's counter, so the count is
 * an estimate, not the provider's exact number: characters / 4 over everything the model would
 * read (system prompt, message text, tool-call and tool-result payloads, tool names, descriptions
 * and JSON schemas), plus a fixed cost per image or file. Real tokenizers differ by model and
 * language, so the number can be off either way. It is for sizing and budgeting, not billing.
 */
import type { PlugPart, PlugRequest } from "../contract.js"

/** Tokens charged for each image or file part, whatever its size (the real cost depends on the size). */
export const MEDIA_TOKENS = 1600
const CHARS_PER_TOKEN = 4

const jsonLength = (value: unknown): number => (JSON.stringify(value) ?? "").length

const partChars = (part: PlugPart): number => {
  switch (part.type) {
    case "text":
      return part.text.length
    case "tool-call":
      return part.name.length + jsonLength(part.input)
    case "tool-result":
      return part.name.length + part.result.length
    case "media":
      return 0
  }
}

/** The estimated input tokens of a resolved request. Ceiling of characters / 4, plus `MEDIA_TOKENS` per media part. */
export function estimateTokens(request: Pick<PlugRequest, "system" | "messages" | "tools">): number {
  let chars = request.system.join("").length
  let media = 0
  for (const message of request.messages)
    for (const part of message.content) {
      if (part.type === "media") media++
      else chars += partChars(part)
    }
  for (const tool of request.tools) chars += tool.name.length + tool.description.length + jsonLength(tool.parameters)
  return Math.ceil(chars / CHARS_PER_TOKEN) + media * MEDIA_TOKENS
}
