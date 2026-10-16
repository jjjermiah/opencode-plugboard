/**
 * #411 Thinking text can name a tool by the placeholder id the model was shown. The producer is
 * `@ex-machina/opencode-anthropic-auth` 2.0.0-next.x: `mcp_T` plus base64url(name) for a name of
 * 44 bytes or fewer, `mcp_H` plus base64url(sha256(name)) for a longer one. plugboard rewrites an
 * id only when it is one of THIS request's tools (src/tool-placeholders.ts).
 */
import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { placeholderAliases, placeholderRewriter } from "../../src/tool-placeholders.js"

const aliases = placeholderAliases(["get_weather", "convert_temp"])

/** Runs `chunks` through a rewriter as a stream would, then the flush, and joins what came out. */
function through(chunks: string[], map: ReadonlyMap<string, string> = aliases): string {
  const rewrite = placeholderRewriter(map)
  return chunks.map((chunk) => rewrite.push(chunk)).join("") + rewrite.flush()
}

describe("#411 placeholderAliases: the ids the producer gives this request's tools", () => {
  test("a short name's id is mcp_T plus base64url of the name", () => {
    expect(aliases.get("mcp_TZ2V0X3dlYXRoZXI")).toBe("get_weather")
    expect(aliases.get("mcp_TY29udmVydF90ZW1w")).toBe("convert_temp")
  })

  test("a name longer than 44 bytes is mcp_H plus base64url of its sha256", () => {
    const long = "a_very_long_tool_name_that_goes_past_the_limit_".repeat(2)
    expect(Buffer.byteLength(long)).toBeGreaterThan(44)
    const id = `mcp_H${createHash("sha256").update(long).digest("base64url")}`
    expect(placeholderAliases([long]).get(id)).toBe(long)
  })

  test("the 1.x plugin form is mcp_ plus the name with its first letter upper-cased", () => {
    expect(aliases.get("mcp_Get_weather")).toBe("get_weather")
  })

  test("only the request's own tools are aliases: a decodable id of another name is not", () => {
    expect(aliases.has("mcp_TZm9v")).toBe(false) // base64url("foo")
    expect(aliases.has("mcp_Tbm90")).toBe(false) // base64url("not")
  })
})

describe("#411 placeholderRewriter", () => {
  test("rewrites this request's id in one chunk, and every such id in a text", () => {
    expect(through(['I will call "mcp_TZ2V0X3dlYXRoZXI" then "mcp_TY29udmVydF90ZW1w".'])).toBe('I will call "get_weather" then "convert_temp".')
  })

  test("an id of the 44-byte-or-longer form is rewritten, whole and split across deltas", () => {
    const long = "a_very_long_tool_name_that_goes_past_the_limit_".repeat(2)
    const map = placeholderAliases([long])
    const id = `mcp_H${createHash("sha256").update(long).digest("base64url")}`
    expect(through([`call ${id} now`], map)).toBe(`call ${long} now`)
    expect(through([`call ${id.slice(0, 20)}`, `${id.slice(20, 50)}`, `${id.slice(50)} now`], map)).toBe(`call ${long} now`)
  })

  test("text that is not one of this request's ids is left as it is", () => {
    // `mcp_Tbm90` decodes to a plain word, `mcp_servers` is a parameter name, `mcp_` is nothing: none is a tool here.
    expect(through(["a mcp_Tbm90 b mcp_servers c mcp_ d"])).toBe("a mcp_Tbm90 b mcp_servers c mcp_ d")
  })

  test("an id followed by more id characters is not this request's id: the whole run must match", () => {
    expect(through(["use mcp_TZ2V0X3dlYXRoZXI_tool and mcp_TZ2V0X3dlYXRoZXI-based"])).toBe("use mcp_TZ2V0X3dlYXRoZXI_tool and mcp_TZ2V0X3dlYXRoZXI-based")
  })

  test("an id split across deltas is rewritten once, whatever the split", () => {
    expect(through(['use "mcp_TZ2', "V0X3dl", 'YXRoZXI" now'])).toBe('use "get_weather" now')
    expect(through(["use mc", "p_TZ2V0X3dlYXRoZXI now"])).toBe("use get_weather now")
    expect(through(["use mcp", "_TZ2V0X3dlYXRoZXI", " now"])).toBe("use get_weather now")
  })

  test("an id that ends the stream is held until flush, then rewritten", () => {
    const rewrite = placeholderRewriter(aliases)
    expect(rewrite.push("ok mcp_TZ2V0X3dlYXRoZXI")).toBe("ok ")
    expect(rewrite.flush()).toBe("get_weather")
  })

  test("a word that is not an id is not held back", () => {
    const rewrite = placeholderRewriter(aliases)
    expect(rewrite.push("hello world")).toBe("hello world")
  })

  test("a word ending in the start of mcp_ waits one chunk; the held text is emitted unchanged", () => {
    const rewrite = placeholderRewriter(aliases)
    expect(rewrite.push("I am")).toBe("I a")
    expect(rewrite.flush()).toBe("m")
  })
})
