/** Session titles and stored transcripts (src/session/history.ts), including #89 control-character stripping. */
import { describe, expect, test } from "bun:test"
import type { PlugRequest } from "../../src/contract.js"
import { makeTitle, oneLine, renderTranscript } from "../../src/session/history.js"
import { plugRequest } from "../support/fixtures.js"

const said = (text: string): PlugRequest => plugRequest({ messages: [{ role: "user", content: [{ type: "text", text }] }] })

describe("makeTitle", () => {
  test("the first non-blank user text, on one line", () => {
    expect(
      makeTitle(
        plugRequest({
          messages: [
            { role: "assistant", content: [{ type: "text", text: "earlier" }] },
            {
              role: "user",
              content: [
                { type: "text", text: "   " },
                { type: "text", text: "Write\n  a\tpoem" },
              ],
            },
          ],
        }),
      ),
    ).toBe("Write a poem")
  })

  test("cut to 60 characters with an ellipsis", () => {
    const title = makeTitle(said("x".repeat(100)))
    expect(title).toHaveLength(60)
    expect(title.endsWith("…")).toBe(true)
  })

  test("the model string when there is no user text", () => {
    expect(makeTitle(plugRequest({ model: "fast", messages: [{ role: "user", content: [{ type: "media", url: "data:x" }] }] }))).toBe("fast")
  })

  test.each([
    ["an ANSI escape (ESC [)", "\u001b[31mred\u001b[0m", "[31mred[0m"],
    ["a bell and a backspace", "a\u0007b\u0008c", "abc"],
    ["DEL and a C1 CSI", "a\u007fb\u009bc", "abc"],
    ["bidi overrides that reorder text", "invoice\u202egpj.exe", "invoicegpj.exe"],
    ["bidi isolates and marks", "a\u2066b\u2069c\u200ed\u200fe\u061cf", "abcdef"],
  ])("#89 strips %s", (_name, text, title) => {
    expect(makeTitle(said(text))).toBe(title)
  })

  test("oneLine collapses whitespace before stripping", () => {
    expect(oneLine(" a \r\n b ")).toBe("a b")
  })
})

describe("renderTranscript", () => {
  test("system, each message by role, tool calls and results, images by number, then the tool names", () => {
    const request = plugRequest({
      system: ["be brief"],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            { type: "media", url: "data:a" },
            { type: "media", url: "data:b" },
          ],
        },
        { role: "assistant", content: [{ type: "tool-call", id: "c1", name: "lookup", input: { q: 1 } }] },
        { role: "tool", content: [{ type: "tool-result", id: "c1", name: "lookup", result: "42", isError: true }] },
      ],
      tools: [{ name: "lookup", description: "", parameters: {} }],
    })
    expect(renderTranscript(request)).toBe(
      [
        "## system",
        "be brief",
        "",
        "## user",
        "look",
        "[image 1]",
        "[image 2]",
        "",
        "## assistant",
        '[tool call lookup (c1)] {"q":1}',
        "",
        "## tool",
        "[tool result lookup (c1) (error)] 42",
        "",
        "## tools",
        "lookup",
      ].join("\n"),
    )
  })

  test("#89 body text keeps line breaks and tabs but loses escapes; tool names and ids are one line", () => {
    const request = plugRequest({
      messages: [
        { role: "user", content: [{ type: "text", text: "line 1\n\tline 2\u001b[2J" }] },
        { role: "assistant", content: [{ type: "tool-call", id: "c\n1", name: "evil\u202ename", input: "raw" }] },
      ],
    })
    expect(renderTranscript(request)).toBe("## user\nline 1\n\tline 2[2J\n\n## assistant\n[tool call evilname (c 1)] raw")
  })

  test("an empty request still stores something", () => {
    expect(renderTranscript(plugRequest({ messages: [] }))).toBe("(empty request)")
  })
})
