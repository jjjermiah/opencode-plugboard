/**
 * #411 Thinking text can name a tool by the placeholder id the model sees (`mcp_` plus `T` plus the
 * base64url of the tool's name). plugboard rewrites those ids to the caller's tool name, including an
 * id split across two stream deltas (src/tool-placeholders.ts).
 */
import { describe, expect, test } from "bun:test"
import { placeholderRewriter, toolNameOf } from "../../src/tool-placeholders.js"

/** Runs `chunks` through a rewriter as a stream would, then the flush, and joins what came out. */
function through(chunks: string[]): string {
  const rewrite = placeholderRewriter()
  return chunks.map((chunk) => rewrite.push(chunk)).join("") + rewrite.flush()
}

describe("#411 toolNameOf", () => {
  test("decodes the two ids in the issue to their tool names", () => {
    expect(toolNameOf("mcp_TZ2V0X3dlYXRoZXI")).toBe("get_weather")
    expect(toolNameOf("mcp_TY29udmVydF90ZW1w")).toBe("convert_temp")
  })

  test("is undefined for a word that is not an encoded name", () => {
    expect(toolNameOf("mcp_servers")).toBeUndefined()
    expect(toolNameOf("mcp_")).toBeUndefined()
    expect(toolNameOf("mcp_TZ2V0X3dlYXRoZXJ!")).toBeUndefined()
  })
})

describe("#411 placeholderRewriter", () => {
  test("rewrites a whole id in one chunk, and every id in a text", () => {
    expect(through(['I will call "mcp_TZ2V0X3dlYXRoZXI" then "mcp_TY29udmVydF90ZW1w".'])).toBe('I will call "get_weather" then "convert_temp".')
  })

  test("leaves text without an id, and a word that only looks like one, unchanged", () => {
    expect(through(["plain text, mcp_servers and mcp_ stay"])).toBe("plain text, mcp_servers and mcp_ stay")
  })

  test("an id split across deltas is rewritten once, whatever the split", () => {
    expect(through(['use "mcp_TZ2', "V0X3dl", 'YXRoZXI" now'])).toBe('use "get_weather" now')
    expect(through(["use mc", "p_TZ2V0X3dlYXRoZXI now"])).toBe("use get_weather now")
    expect(through(["use mcp", "_TZ2V0X3dlYXRoZXI", " now"])).toBe("use get_weather now")
  })

  test("an id that ends the stream is held until flush, then rewritten", () => {
    const rewrite = placeholderRewriter()
    expect(rewrite.push("ok mcp_TZ2V0X3dlYXRoZXI")).toBe("ok ")
    expect(rewrite.flush()).toBe("get_weather")
  })

  test("text that cannot start an id is not held back", () => {
    const rewrite = placeholderRewriter()
    expect(rewrite.push("hello world")).toBe("hello world")
  })
})
