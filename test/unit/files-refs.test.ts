/**
 * Where each API names a stored file, and what replaces the reference (src/files/refs.ts). The rewrite is pure: a body with
 * no reference comes back as the same object, and the input is never mutated.
 */
import { describe, expect, test } from "bun:test"
import { isPlugError } from "../../src/contract.js"
import { fileRefs, geminiFileId, inlineFiles, restoreFileRefs, type InlineFile } from "../../src/files/refs.js"

const HEX = "0123456789abcdef0123456789abcdef"
const ID = `file-${HEX}`
const OTHER = `file-${"f".repeat(32)}`
const b64 = (text: string) => Buffer.from(text).toString("base64")
const png: InlineFile = { mime: "image/png", base64: "iVBORw0KGgo=" }
const pdf: InlineFile = { mime: "application/pdf", base64: b64("%PDF-1.4") }
const text: InlineFile = { mime: "text/plain", base64: b64("plain words") }
const files = (file: InlineFile, id = ID) => new Map([[id, file]])

describe("geminiFileId", () => {
  test("files/<hex>, files/file-<hex> and the uri an upload returned name a file; nothing else does", () => {
    expect(geminiFileId(`files/${HEX}`)).toBe(ID)
    expect(geminiFileId(`files/${ID}`)).toBe(ID)
    expect(geminiFileId(`https://127.0.0.1:4010/v1beta/files/${HEX}`)).toBe(ID)
    expect(geminiFileId(`http://plug.example/v1beta/files/${HEX.toUpperCase()}`)).toBe(ID)
    for (const uri of ["files/abc", `files/${HEX}/x`, "https://example.com/p.png", `https://example.com/img/${HEX}`, `gs://bucket/files/${HEX}`, `https://example.com/v1beta/files/${HEX}?x=1`, ""])
      expect(geminiFileId(uri)).toBeUndefined()
  })
})

describe("fileRefs", () => {
  test("finds each API's reference, once per id, in message order", () => {
    const part = { type: "file", file: { file_id: ID } }
    expect(fileRefs("chat", { messages: [{ role: "user", content: [part, { type: "text", text: "x" }, { type: "file", file: { file_id: OTHER } }, part] }] })).toEqual([ID, OTHER])
    expect(
      fileRefs("responses", {
        input: [
          {
            role: "user",
            content: [
              { type: "input_file", file_id: ID },
              { type: "input_image", file_id: OTHER },
            ],
          },
        ],
      }),
    ).toEqual([ID, OTHER])
    expect(fileRefs("messages", { messages: [{ role: "user", content: [{ type: "document", source: { type: "file", file_id: ID } }] }] })).toEqual([ID])
    expect(fileRefs("gemini", { contents: [{ parts: [{ fileData: { fileUri: `files/${HEX}` } }, { file_data: { file_uri: `files/${"f".repeat(32)}` } }] }] })).toEqual([ID, OTHER])
  })

  test("a Responses history array is read as input items", () => {
    expect(fileRefs("responses", { input: "hi" }, [{ role: "user", content: [{ type: "input_file", file_id: ID }] }])).toEqual([ID])
  })

  test("Anthropic reads a tool_result's blocks too", () => {
    const body = { messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: [{ type: "image", source: { type: "file", file_id: ID } }] }] }] }
    expect(fileRefs("messages", body)).toEqual([ID])
  })

  test("what is not a reference is not found: strings, other sources, other positions, other types", () => {
    expect(fileRefs("chat", { messages: [{ role: "user", content: "text with file_id" }] })).toEqual([])
    expect(fileRefs("chat", { messages: [{ role: "user", content: [{ type: "file", file: { file_data: "data:..." } }] }] })).toEqual([])
    expect(fileRefs("chat", { metadata: { type: "file", file: { file_id: ID } }, messages: [] })).toEqual([])
    expect(fileRefs("responses", { input: [{ role: "user", content: [{ type: "input_text", file_id: ID }] }] })).toEqual([])
    expect(fileRefs("messages", { messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", data: "x" } }] }] })).toEqual([])
    expect(fileRefs("messages", { messages: [{ role: "assistant", content: [{ type: "tool_use", id: "x", name: "n", input: { type: "file", file: { file_id: ID } } }] }] })).toEqual([])
    expect(fileRefs("gemini", { contents: [{ parts: [{ fileData: { fileUri: "https://example.com/a.png" } }] }] })).toEqual([])
    for (const body of [null, 1, "x", [], {}, { messages: "x" }, { messages: [1, null, { content: 3 }] }, { contents: [{ parts: "x" }] }]) expect(fileRefs("chat", body)).toEqual([])
  })
})

describe("inlineFiles", () => {
  test("a body that names no file is returned as the same object", () => {
    const body = { messages: [{ role: "user", content: [{ type: "text", text: "x" }] }] }
    expect(inlineFiles("chat", body, new Map())).toBe(body)
  })

  test("Chat: an image is an image_url, a PDF a file_data part, text a text part", () => {
    const body = (id: string) => ({ model: "m", messages: [{ role: "user", content: [{ type: "file", file: { file_id: id, filename: "n.pdf" } }] }] })
    expect(inlineFiles("chat", body(ID), files(png))).toEqual({ model: "m", messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${png.base64}` } }] }] })
    expect(inlineFiles("chat", body(ID), files(pdf))).toEqual({
      model: "m",
      messages: [{ role: "user", content: [{ type: "file", file: { file_data: `data:application/pdf;base64,${pdf.base64}`, filename: "n.pdf" } }] }],
    })
    expect(inlineFiles("chat", body(ID), files(text))).toEqual({ model: "m", messages: [{ role: "user", content: [{ type: "text", text: "plain words" }] }] })
  })

  test("Responses: input_image takes an image only; input_file takes a PDF or text, and an image too", () => {
    const item = (part: object) => ({ input: [{ role: "user", content: [part] }] })
    expect(inlineFiles("responses", item({ type: "input_image", file_id: ID, detail: "low" }), files(png))).toEqual(item({ type: "input_image", image_url: `data:image/png;base64,${png.base64}` }))
    expect(inlineFiles("responses", item({ type: "input_file", file_id: ID }), files(pdf))).toEqual(item({ type: "input_file", file_data: `data:application/pdf;base64,${pdf.base64}` }))
    expect(inlineFiles("responses", item({ type: "input_file", file_id: ID }), files(text))).toEqual(item({ type: "input_text", text: "plain words" }))
    expect(inlineFiles("responses", item({ type: "input_file", file_id: ID }), files(png))).toEqual(item({ type: "input_image", image_url: `data:image/png;base64,${png.base64}` }))
    const wrong = inlineFiles("responses", item({ type: "input_image", file_id: ID }), files(pdf))
    expect(isPlugError(wrong) && wrong).toMatchObject({ status: 400, code: "invalid_file" })
  })

  test("Messages: the block keeps its other fields; image takes an image, document a PDF or text", () => {
    const body = (block: object) => ({ messages: [{ role: "user", content: [block] }] })
    const image = { type: "image", cache_control: { type: "ephemeral" }, source: { type: "file", file_id: ID } }
    expect(inlineFiles("messages", body(image), files(png))).toEqual(
      body({ type: "image", cache_control: { type: "ephemeral" }, source: { type: "base64", media_type: "image/png", data: png.base64 } }),
    )
    const doc = { type: "document", title: "T", source: { type: "file", file_id: ID } }
    expect(inlineFiles("messages", body(doc), files(pdf))).toEqual(body({ type: "document", title: "T", source: { type: "base64", media_type: "application/pdf", data: pdf.base64 } }))
    expect(inlineFiles("messages", body(doc), files(text))).toEqual(body({ type: "document", title: "T", source: { type: "text", media_type: "text/plain", data: "plain words" } }))
    for (const wrong of [inlineFiles("messages", body(image), files(pdf)), inlineFiles("messages", body(doc), files(png))])
      expect(isPlugError(wrong) && wrong).toMatchObject({ status: 400, code: "invalid_file" })
  })

  test("Messages: a tool_result block is rewritten in place", () => {
    const body = { messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: [{ type: "image", source: { type: "file", file_id: ID } }] }] }] }
    expect(inlineFiles("messages", body, files(png))).toEqual({
      messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: png.base64 } }] }] }],
    })
  })

  test("Gemini: media is inlineData, text is a text part", () => {
    const body = { contents: [{ role: "user", parts: [{ fileData: { fileUri: `files/${HEX}`, mimeType: "image/jpeg" } }] }] }
    expect(inlineFiles("gemini", body, files(png))).toEqual({ contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/png", data: png.base64 } }] }] })
    expect(inlineFiles("gemini", body, files(text))).toEqual({ contents: [{ role: "user", parts: [{ text: "plain words" }] }] })
  })

  test("#547 a file the caller does not hold is the 404 the Files routes answer, in the error kind of the API", () => {
    const cases = [
      inlineFiles("chat", { messages: [{ content: [{ type: "file", file: { file_id: ID } }] }] }, new Map()),
      inlineFiles("responses", { input: [{ content: [{ type: "input_file", file_id: ID }] }] }, new Map()),
      inlineFiles("messages", { messages: [{ content: [{ type: "image", source: { type: "file", file_id: ID } }] }] }, new Map()),
      inlineFiles("gemini", { contents: [{ parts: [{ fileData: { fileUri: `files/${HEX}` } }] }] }, new Map()),
    ]
    expect(cases).toEqual([
      { status: 404, kind: "invalid_request", message: `No such File object: ${ID}` },
      { status: 404, kind: "invalid_request", message: `No such File object: ${ID}` },
      { status: 404, kind: "not_found", message: `File not found: ${ID}` },
      { status: 404, kind: "not_found", message: `File files/${HEX} was not found` },
    ])
  })

  test("items and parts that are not objects are passed through untouched beside a reference", () => {
    const body = { messages: [1, null, { role: "user", content: ["loose", 7, { type: "file", file: { file_id: ID } }] }] }
    expect(inlineFiles("chat", body, files(png))).toEqual({
      messages: [1, null, { role: "user", content: ["loose", 7, { type: "image_url", image_url: { url: `data:image/png;base64,${png.base64}` } }] }],
    })
  })

  test("the input body is not mutated", () => {
    const body = { messages: [{ role: "user", content: [{ type: "file", file: { file_id: ID } }] }] }
    const before = JSON.stringify(body)
    inlineFiles("chat", body, files(png))
    expect(JSON.stringify(body)).toBe(before)
  })
})

describe("restoreFileRefs", () => {
  test("puts the reference back where inlineFiles replaced one, and leaves every other item as it is", () => {
    const item = {
      role: "user",
      content: [
        { type: "input_text", text: "x" },
        { type: "input_file", file_id: ID, filename: "n.pdf" },
      ],
    }
    const inlined = inlineFiles("responses", { input: [item, { role: "user", content: "plain" }] }, files(pdf))
    if (isPlugError(inlined)) throw new Error("inlined")
    const items = (inlined as { input: Array<Record<string, unknown>> }).input
    expect(JSON.stringify(items[0])).toContain("data:application/pdf")
    const restored = restoreFileRefs(items)
    expect(restored[0]).toEqual(item)
    expect(restored[1]).toBe(items[1])
  })
})
