/**
 * #143, #144, #412 The count endpoints' estimate: calibrated against the provider's own counts (see
 * src/anthropic/tokens.ts). The number is an estimate by design.
 */
import { describe, expect, test } from "bun:test"
import { appPolicy } from "../../src/config.js"
import { MEDIA_TOKENS, estimateTokens, imageSize } from "../../src/anthropic/tokens.js"
import type { PlugPart } from "../../src/contract.js"
import { requestSystem } from "../../src/session/context.js"
import { plugRequest, testOptions } from "../support/fixtures.js"

describe("#201 count_tokens counts the system prompt plugboard adds", () => {
  const base = plugRequest({ system: ["Caller prompt."] })
  const policy = (system: string, systemMode: "prepend" | "append" | "replace") => appPolicy(testOptions({ apps: { default: { system, systemMode } } }), "default")

  test("the app's system policy is part of the count: 400 characters add exactly 80 tokens (5 characters a token)", () => {
    const plain = estimateTokens({ ...base, system: requestSystem(base, [], undefined) })
    const prepended = estimateTokens({ ...base, system: requestSystem(base, [], policy("P".repeat(400), "prepend")) })
    expect(prepended - plain).toBe(80)
  })

  test("replace drops the caller's prompt from the count, so only the policy counts", () => {
    const replaced = requestSystem(base, [], policy("Only this.", "replace"))
    expect(replaced).toEqual(["Only this."])
  })

  test("a required tool choice adds its steering sentence to the count", () => {
    const steered = requestSystem({ ...base, toolChoice: "required" }, [], undefined)
    expect(steered).toEqual(["Caller prompt.", "You must respond by calling one of the provided tools."])
    expect(estimateTokens({ ...base, system: steered })).toBeGreaterThan(estimateTokens({ ...base, system: requestSystem(base, [], undefined) }))
  })

  test("the skill prelude comes before the caller's prompt", () => {
    expect(requestSystem(base, ["Skill body."], undefined)).toEqual(["Skill body.", "Caller prompt."])
  })
})

/** A request with one user turn holding `content`. */
const turn = (...content: PlugPart[]) => plugRequest({ messages: [{ role: "user", content }] })

const text = (value: string) => ({ type: "text" as const, text: value })
const media = (url: string) => ({ type: "media" as const, url, mediaType: "image/png" })

/** A PNG (or GIF) data URL whose header carries the given size. */
const pngUrl = (width: number, height: number) => {
  const header = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header)
  header.write("IHDR", 12, "latin1")
  header.writeUInt32BE(width, 16)
  header.writeUInt32BE(height, 20)
  return `data:image/png;base64,${header.toString("base64")}`
}

describe("imageSize reads the header of each format", () => {
  const dataUrl = (type: string, bytes: Buffer) => `data:${type};base64,${bytes.toString("base64")}`
  const le16 = (n: number) => Buffer.from([n & 0xff, n >> 8])
  const be16 = (n: number) => Buffer.from([n >> 8, n & 0xff])
  /** A 30-byte WebP container with the given chunk tag (the reader needs 30 bytes). */
  const webp = (tag: string) => {
    const b = Buffer.alloc(30)
    b.write("RIFF", 0, "latin1")
    b.write("WEBP", 8, "latin1")
    b.write(tag, 12, "latin1")
    return b
  }

  test("GIF: the logical screen size", () => {
    expect(imageSize(dataUrl("image/gif", Buffer.concat([Buffer.from("GIF89a"), le16(320), le16(200)])))).toEqual({ width: 320, height: 200 })
  })

  test("WebP, lossy (VP8): 14-bit width and height", () => {
    const b = webp("VP8 ")
    b.writeUInt16LE(640, 26)
    b.writeUInt16LE(480, 28)
    expect(imageSize(dataUrl("image/webp", b))).toEqual({ width: 640, height: 480 })
  })

  test("WebP, lossless (VP8L): width and height minus one, packed in 14 bits each", () => {
    const w = 640 - 1
    const h = 480 - 1
    const b = webp("VP8L")
    b[21] = w & 0xff
    b[22] = ((w >> 8) & 0x3f) | ((h & 0x3) << 6)
    b[23] = (h >> 2) & 0xff
    b[24] = (h >> 10) & 0xf
    expect(imageSize(dataUrl("image/webp", b))).toEqual({ width: 640, height: 480 })
  })

  test("WebP, extended (VX8): the canvas size, minus one, in 24 bits each", () => {
    const b = webp("VP8X")
    b.writeUIntLE(639, 24, 3)
    b.writeUIntLE(479, 27, 3)
    expect(imageSize(dataUrl("image/webp", b))).toEqual({ width: 640, height: 480 })
  })

  test("JPEG: the first frame header, past a restart marker, a fill byte, an application segment and a table", () => {
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]), // SOI
      Buffer.from([0xff, 0xd0]), // RST0: no length
      Buffer.from([0xff, 0xff]), // fill byte
      Buffer.from([0xff, 0xe0, 0x00, 0x10]),
      Buffer.alloc(14), // APP0
      Buffer.from([0xff, 0xc4, 0x00, 0x02]), // DHT: not a frame header
      Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]), // SOF0: height and width follow the precision
      be16(480),
      be16(640),
      Buffer.from([0x03, ...Array(9).fill(0)]),
    ])
    expect(imageSize(dataUrl("image/jpeg", jpeg))).toEqual({ width: 640, height: 480 })
  })

  test("a JPEG with no frame header, a format it does not know, and a truncated PNG have no size", () => {
    expect(imageSize(dataUrl("image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02])))).toBeUndefined()
    expect(imageSize(dataUrl("image/bmp", Buffer.from("BM".padEnd(30, "\0"))))).toBeUndefined()
    expect(imageSize(dataUrl("image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))).toBeUndefined()
    expect(imageSize("https://example.com/cat.png")).toBeUndefined()
  })
})

describe("#412 the token estimate", () => {
  test("a request costs a fixed overhead before any message (21 tokens for Claude, none for Gemini)", () => {
    expect(estimateTokens(plugRequest({ messages: [] }))).toBe(21)
    expect(estimateTokens(plugRequest({ messages: [] }), "gemini-3.8-flash")).toBe(0)
  })

  test("Latin text costs one token per five characters", () => {
    const empty = estimateTokens(turn(text("")))
    expect(estimateTokens(turn(text("a".repeat(50)))) - empty).toBe(10)
  })

  test("a CJK character costs one token on Claude and about two thirds of one on Gemini", () => {
    const cjk = "你".repeat(30)
    expect(estimateTokens(turn(text(cjk))) - estimateTokens(turn(text("")))).toBe(30)
    expect(estimateTokens(turn(text(cjk)), "gemini-3.8-flash")).toBe(21)
  })

  test("a request that declares tools pays the tool-use preamble and a fixed cost per tool", () => {
    const tool = { name: "weather", description: "Weather", parameters: { type: "object" } }
    // 21 request + 534 preamble + 40 per tool + (7 + 7 + 17 characters) / 5
    expect(estimateTokens(plugRequest({ messages: [], tools: [tool] }))).toBe(602)
  })

  test("a tool call and its result each cost a fixed block plus their payloads", () => {
    // 21 request + 4 message + 35 block + 1 name ("abcde") + 0.4 input ("{}"), rounded up
    const call = plugRequest({ messages: [{ role: "assistant", content: [{ type: "tool-call", id: "c1", name: "abcde", input: {} }] }] })
    expect(estimateTokens(call)).toBe(62)
    // 21 request + 35 block + 1 name + 1 result ("abcde"), rounded up; a tool message is not a turn
    const result = plugRequest({ messages: [{ role: "tool", content: [{ type: "tool-result", id: "c1", name: "abcde", result: "abcde" }] }] })
    expect(estimateTokens(result)).toBe(58)
  })

  test("#374 replayed reasoning counts its text, signature and redacted data", () => {
    const reasoning = plugRequest({ messages: [{ role: "assistant", content: [{ type: "reasoning", text: "plan", signature: "sig" }, { type: "reasoning", text: "", redactedData: "opaque" }] }] })
    // 21 request + 4 message + (4 + 3 + 6) characters / 5, rounded up
    expect(estimateTokens(reasoning)).toBe(Math.ceil(21 + 4 + 13 / 5))
  })

  test("an image costs Anthropic's formula on its header size: width * height / 750 after downscaling", () => {
    expect(imageSize(pngUrl(1024, 768))).toEqual({ width: 1024, height: 768 })
    expect(estimateTokens(turn(media(pngUrl(1024, 768))))).toBe(21 + 4 + 1049)
    expect(estimateTokens(turn(media(pngUrl(320, 200))))).toBe(21 + 4 + 86)
    // 1568 x 1568 is downscaled to about 1.15 megapixels first: 1073 x 1073 / 750
    expect(estimateTokens(turn(media(pngUrl(1568, 1568))))).toBe(21 + 4 + 1534)
  })

  test("an image whose size cannot be read costs MEDIA_TOKENS", () => {
    expect(estimateTokens(turn(media("https://example.com/cat.png")))).toBe(21 + 4 + MEDIA_TOKENS)
  })

  test("a Gemini image costs a flat 1090 tokens, whatever its size", () => {
    expect(estimateTokens(turn(media(pngUrl(320, 200))), "gemini-3.8-flash")).toBe(1090)
    expect(estimateTokens(turn(media(pngUrl(1024, 768))), "gemini-3.8-flash")).toBe(1090)
  })
})

describe("#412 a Claude 5.x model has its own profile", () => {
  test("the fixed request cost and the characters per token follow the family, not the id's tail", () => {
    expect(estimateTokens(plugRequest({ messages: [] }), "claude-sonnet-5-5")).toBe(45)
    expect(estimateTokens(plugRequest({ messages: [] }), "claude-haiku-5-5")).toBe(45)
    expect(estimateTokens(plugRequest({ messages: [] }), "claude-haiku-4-5")).toBe(21)
    const long = turn(text("a".repeat(2550)))
    expect(estimateTokens(long, "claude-sonnet-5-5")).toBeCloseTo(45 + 4 + 1000, 6)
    expect(estimateTokens(long, "claude-haiku-4-5")).toBeCloseTo(21 + 4 + 510, 6)
  })
})
