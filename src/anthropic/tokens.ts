/**
 * Token counts for `count_tokens` (Anthropic #143) and `countTokens` (Gemini #144).
 *
 * plugboard has no tokenizer, and the host does not expose the provider's counter, so the count is an estimate, not
 * the provider's exact number. It is calibrated against live counts (#412): the provider's own `usage.input_tokens`
 * (Claude) or `promptTokenCount` (Gemini) for the same request, measured on Claude Haiku 4.5 and Gemini 3.x. The
 * profile is picked by the model id: a Gemini model gets the Gemini profile, a Claude 5.x model the Claude 5 profile (#412), any other the Claude one.
 *
 * Claude: characters / 5 for Latin text, one token per CJK character, a fixed cost per message, per tool-call and
 * tool-result block, and a preamble of about 530 tokens once tools are declared (the tool-use framing), plus about
 * 40 per tool. Images cost Anthropic's pixel formula, width * height / 750 after its downscaling, read from the image
 * header; a remote or unreadable image costs `MEDIA_TOKENS`.
 * Gemini: characters / 5, about two thirds of a token per CJK character, and a flat cost per image.
 */
import type { PlugPart, PlugRequest } from "../contract.js"

/** Tokens charged for an image whose size cannot be read (a remote URL, or a document): the largest Claude image. */
export const MEDIA_TOKENS = 1600

interface Profile {
  /** Latin characters per token. */
  readonly charsPerToken: number
  /** Fixed tokens per request, before any message. */
  readonly request: number
  /** Tokens per CJK character (ideographs, kana, hangul, full-width punctuation). */
  readonly cjkTokens: number
  /** Fixed tokens per message (user and assistant turns; tool results are not counted here). */
  readonly message: number
  /** Fixed tokens per tool-call or tool-result block. */
  readonly toolBlock: number
  /** Fixed tokens once the request declares any tool. */
  readonly toolPreamble: number
  /** Fixed tokens per declared tool. */
  readonly perTool: number
  /** Fixed tokens per image, whatever its size; undefined: Anthropic's pixel formula. */
  readonly flatImage?: number
  /** Tokens per image whose size cannot be read. */
  readonly unreadableImage: number
}

const CLAUDE: Profile = { charsPerToken: 5, cjkTokens: 1, request: 21, message: 4, toolBlock: 35, toolPreamble: 534, perTool: 40, unreadableImage: MEDIA_TOKENS }
const GEMINI: Profile = { charsPerToken: 5, cjkTokens: 0.67, request: 0, message: 0, toolBlock: 0, toolPreamble: 0, perTool: 0, flatImage: 1090, unreadableImage: 1090 }
/**
 * Claude 5.x (#412): its tokenizer packs Latin text into about 3.4 characters per token, not 5, its fixed request cost is
 * about 35 tokens, and one tool adds about 340 tokens of framing (the tool's own text is counted on top). Fitted to live
 * `usage.input_tokens` of `claude-sonnet-5-5` and `claude-haiku-5-5` (2026-10-16): a short and a 2072-character user turn,
 * each with and without one tool. The four rows of each model agree to 1 token.
 */
const CLAUDE_5: Profile = { charsPerToken: 3.38, cjkTokens: 1, request: 35, message: 4, toolBlock: 35, toolPreamble: 299, perTool: 40, unreadableImage: MEDIA_TOKENS }

/** The profile for a model id: Gemini, Claude 5.x (`claude-<family>-5-...`), or the Claude 4.x profile for every other id. */
const profileOf = (model: string): Profile => (/gemini/i.test(model) ? GEMINI : /claude-[a-z]+-5(?:-|$)/i.test(model) ? CLAUDE_5 : CLAUDE)

/** CJK ideographs, kana, hangul, and the full-width punctuation that goes with them. */
const CJK = /[\u3000-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/g

const textTokens = (text: string, profile: Profile): number => {
  const cjk = text.match(CJK)?.length ?? 0
  return cjk * profile.cjkTokens + (text.length - cjk) / profile.charsPerToken
}

interface Size {
  readonly width: number
  readonly height: number
}

const webpSize = (b: Buffer): Size | undefined => {
  const chunk = b.toString("latin1", 12, 16)
  if (chunk === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff }
  if (chunk === "VP8L") return { width: 1 + (((b[22]! & 0x3f) << 8) | b[21]!), height: 1 + (((b[24]! & 0xf) << 10) | (b[23]! << 2) | ((b[22]! & 0xc0) >> 6)) }
  if (chunk === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) }
  return undefined
}

/** The start-of-frame marker of a JPEG: the first SOFn segment (not DHT, JPG or DAC, which share the range). */
const jpegSize = (b: Buffer): Size | undefined => {
  let at = 2
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) {
      at++
      continue
    }
    const marker = b[at + 1]!
    if (marker === 0xff) at++
    else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return { height: b.readUInt16BE(at + 5), width: b.readUInt16BE(at + 7) }
    else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) at += 2
    else at += 2 + b.readUInt16BE(at + 2)
  }
  return undefined
}

/** Pixel size of a base64 `data:` image from its header (PNG, GIF, WebP or JPEG), or undefined. Each read is length-checked. */
export function imageSize(url: string): Size | undefined {
  const match = /^data:[^,]*;base64,(.*)$/s.exec(url)
  if (!match) return undefined
  const b = Buffer.from(match[1]!, "base64")
  if (b.length >= 24 && b[0] === 0x89 && b.toString("latin1", 1, 4) === "PNG") return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
  if (b.length >= 10 && b.toString("latin1", 0, 3) === "GIF") return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) }
  if (b.length >= 30 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return webpSize(b)
  if (b[0] === 0xff && b[1] === 0xd8) return jpegSize(b)
  return undefined
}

/** Anthropic's image formula: downscale to a 1568 px long edge and about 1.15 megapixels, then width * height / 750. */
const claudeImage = ({ width, height }: Size): number => {
  const scale = Math.min(1, 1568 / Math.max(width, height), Math.sqrt(1_150_000 / (width * height)))
  return Math.ceil((width * scale * height * scale) / 750)
}

const mediaTokens = (url: string, profile: Profile): number => {
  if (profile.flatImage !== undefined) return profile.flatImage
  const size = imageSize(url)
  return size && size.width > 0 && size.height > 0 ? claudeImage(size) : profile.unreadableImage
}

const partTokens = (part: PlugPart, profile: Profile): number => {
  switch (part.type) {
    case "text":
      return textTokens(part.text, profile)
    case "tool-call":
      return profile.toolBlock + textTokens(part.name, profile) + textTokens(JSON.stringify(part.input) ?? "", profile)
    case "tool-result":
      return profile.toolBlock + textTokens(part.name, profile) + textTokens(part.result, profile)
    case "reasoning":
      return textTokens(part.text, profile) + textTokens(part.signature ?? "", profile) + textTokens(part.redactedData ?? "", profile)
    case "media":
      return mediaTokens(part.url, profile)
  }
}

/**
 * The estimated input tokens of a resolved request, for `model` (the model id, e.g. `claude-haiku-4-5`). The profile
 * is picked from the id; see the header of this file.
 */
export function estimateTokens(request: Pick<PlugRequest, "system" | "messages" | "tools">, model = ""): number {
  const profile = profileOf(model)
  let tokens = profile.request + textTokens(request.system.join(""), profile)
  for (const message of request.messages) {
    if (message.role !== "tool") tokens += profile.message
    for (const part of message.content) tokens += partTokens(part, profile)
  }
  if (request.tools.length > 0) tokens += profile.toolPreamble
  for (const tool of request.tools) tokens += profile.perTool + textTokens(tool.name + tool.description + JSON.stringify(tool.parameters), profile)
  return Math.ceil(tokens)
}
