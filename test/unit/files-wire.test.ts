/**
 * The file objects, paging and upload bodies of the Files APIs (src/files/wire.ts, src/files/multipart.ts).
 */
import { describe, expect, test } from "bun:test"
import { isPlugError } from "../../src/contract.js"
import { cleanFilename, parseFormUpload, parseRelated } from "../../src/files/multipart.js"
import type { FileRecord } from "../../src/files/state.js"
import { attachment, encodeAnthropicFile, encodeGeminiFile, encodeOpenAiFile, geminiName, intQuery, pageItems } from "../../src/files/wire.js"

const record: FileRecord = { id: `file-${"ab".repeat(16)}`, filename: "doc.pdf", mime: "application/pdf", bytes: 12, createdAt: Date.UTC(2026, 9, 17, 12), purpose: "assistants" }
const DAY = 86_400_000

describe("the three faces of a file", () => {
  test("OpenAI", () => {
    expect(encodeOpenAiFile(record, 30)).toEqual({
      id: record.id,
      object: "file",
      bytes: 12,
      created_at: 1_792_238_400,
      expires_at: 1_792_238_400 + 30 * 86_400,
      filename: "doc.pdf",
      purpose: "assistants",
      status: "processed",
      status_details: null,
    })
  })

  test("Anthropic", () => {
    expect(encodeAnthropicFile(record, 2)).toEqual({
      id: record.id,
      type: "file",
      filename: "doc.pdf",
      mime_type: "application/pdf",
      size_bytes: 12,
      created_at: "2026-10-17T12:00:00.000Z",
      downloadable: true,
      expires_at: new Date(record.createdAt + 2 * DAY).toISOString(),
    })
  })

  test("Gemini names the file by the hex of its id, and its uri ends in that name", () => {
    expect(geminiName(record.id)).toBe(`files/${"ab".repeat(16)}`)
    expect(encodeGeminiFile(record, 30, "http://127.0.0.1:4010")).toMatchObject({
      name: `files/${"ab".repeat(16)}`,
      displayName: "doc.pdf",
      mimeType: "application/pdf",
      sizeBytes: "12",
      uri: `http://127.0.0.1:4010/v1beta/files/${"ab".repeat(16)}`,
      state: "ACTIVE",
      source: "UPLOADED",
    })
  })
})

describe("attachment", () => {
  test("quotes, control characters and non-ASCII cannot leave the header value or add a header", () => {
    for (const name of ['a"b.txt', "a\r\nSet-Cookie: x", "naïve ✓.txt", "100%;.txt", "back\\slash"]) {
      const header = attachment(name)
      expect(header).toMatch(/^attachment; filename="[\x20-\x7e]*"; filename\*=UTF-8''[A-Za-z0-9%._-]*$/)
      expect(header.match(/"/g)).toHaveLength(2)
    }
    expect(attachment("naïve.txt")).toContain("filename*=UTF-8''na%C3%AFve.txt")
  })
})

describe("paging", () => {
  const items = ["a", "b", "c", "d", "e"].map((id) => ({ id }))
  const ids = (page: { page: Array<{ id: string }> } | undefined) => page?.page.map((item) => item.id)

  test("limit, after and before, with hasMore in the direction of paging", () => {
    expect(pageItems(items, 2, {})).toEqual({ page: items.slice(0, 2), hasMore: true })
    expect(ids(pageItems(items, 2, { after: "b" }))).toEqual(["c", "d"])
    expect(pageItems(items, 2, { after: "d" })).toEqual({ page: [items[4]!], hasMore: false })
    expect(ids(pageItems(items, 2, { before: "e" }))).toEqual(["c", "d"])
    expect(pageItems(items, 2, { before: "c" })).toEqual({ page: items.slice(0, 2), hasMore: false })
    expect(pageItems(items, 9, {})!.hasMore).toBe(false)
  })

  test("an unknown cursor is undefined", () => {
    expect(pageItems(items, 2, { after: "z" })).toBeUndefined()
    expect(pageItems(items, 2, { before: "z" })).toBeUndefined()
  })

  test("intQuery takes a whole number in range, the default when absent", () => {
    const bounds = { min: 1, max: 10, fallback: 4 }
    expect(intQuery(new URLSearchParams(), "limit", bounds)).toBe(4)
    expect(intQuery(new URLSearchParams("limit=7"), "limit", bounds)).toBe(7)
    for (const bad of ["0", "11", "-1", "1.5", "x", ""]) {
      const error = intQuery(new URLSearchParams({ limit: bad }), "limit", bounds)
      expect(isPlugError(error) && [error.status, error.code, error.param]).toEqual([400, "invalid_limit", "limit"])
    }
  })
})

describe("cleanFilename", () => {
  test("keeps the last path component, drops control characters, caps the length, never returns empty", () => {
    expect(cleanFilename("C:\\Users\\me\\doc.pdf")).toBe("doc.pdf")
    expect(cleanFilename("../../etc/passwd")).toBe("passwd")
    expect(cleanFilename("a\u0000b\nc.txt")).toBe("abc.txt")
    expect(cleanFilename("x".repeat(400))).toHaveLength(255)
    for (const empty of [undefined, "", "   ", "dir/", "\u0001"]) expect(cleanFilename(empty)).toBe("unnamed")
  })
})

describe("parseFormUpload", () => {
  const encode = async (build: (form: FormData) => void) => {
    const form = new FormData()
    build(form)
    const response = new Response(form)
    const type = response.headers.get("content-type")!
    return { type, body: Buffer.from(await response.arrayBuffer()) }
  }

  test("the file part, its name and declared type, and the text fields", async () => {
    const { type, body } = await encode((form) => {
      form.set("purpose", "user_data")
      form.set("file", new Blob(["abc"], { type: "text/plain" }), "dir/a.txt")
    })
    const parsed = await parseFormUpload(type, body)
    if (isPlugError(parsed)) throw new Error(parsed.message)
    expect(parsed.filename).toBe("a.txt")
    // The runtime may add a charset to a text Blob's type.
    expect(parsed.declaredType).toStartWith("text/plain")
    expect(Buffer.from(parsed.bytes).toString()).toBe("abc")
    expect(parsed.fields.get("purpose")).toBe("user_data")
  })

  test("not multipart, no file part, and a body that is not a form are 400s", async () => {
    expect(await parseFormUpload("application/json", Buffer.from("{}"))).toMatchObject({ status: 400, code: "unsupported_media_type" })
    expect(await parseFormUpload(undefined, Buffer.from("{}"))).toMatchObject({ status: 400, code: "unsupported_media_type" })
    const { type, body } = await encode((form) => form.set("purpose", "x"))
    expect(await parseFormUpload(type, body)).toMatchObject({ status: 400, code: "invalid_file_upload" })
    expect(await parseFormUpload("multipart/form-data; boundary=zzz", Buffer.from("garbage"))).toMatchObject({ status: 400 })
  })

  test("a field named file that is text is not a file", async () => {
    const { type, body } = await encode((form) => form.set("file", "just text"))
    expect(await parseFormUpload(type, body)).toMatchObject({ status: 400, code: "invalid_file_upload" })
  })
})

describe("parseRelated", () => {
  const body = (meta: string, media: Buffer, boundary = "B") =>
    Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: image/png\r\n\r\n`), media, Buffer.from(`\r\n--${boundary}--\r\n`)])

  test("metadata, then the bytes exactly, including CRLF inside them", () => {
    const media = Buffer.from("a\r\nb\r\n\r\nc")
    const parsed = parseRelated('multipart/related; boundary="B"', body('{"file":{"displayName":"x"}}', media))
    if (isPlugError(parsed)) throw new Error(parsed.message)
    expect(parsed.metadata).toEqual({ file: { displayName: "x" } })
    expect(parsed.declaredType).toBe("image/png")
    expect(Buffer.from(parsed.bytes)).toEqual(media)
  })

  test("an empty metadata part is {}", () => {
    const parsed = parseRelated("multipart/related; boundary=B", body("", Buffer.from("x")))
    expect(isPlugError(parsed) ? parsed : parsed.metadata).toEqual({})
  })

  test("a missing boundary, another type, the wrong number of parts and bad JSON are 400s", () => {
    expect(parseRelated("multipart/related", Buffer.from("x"))).toMatchObject({ status: 400 })
    expect(parseRelated("multipart/form-data; boundary=B", body("{}", Buffer.from("x")))).toMatchObject({ status: 400 })
    expect(parseRelated(undefined, Buffer.from("x"))).toMatchObject({ status: 400 })
    expect(parseRelated("multipart/related; boundary=B", Buffer.from("--B\r\n\r\nonly\r\n--B--"))).toMatchObject({ status: 400 })
    expect(parseRelated("multipart/related; boundary=B", Buffer.from("--B\r\n\r\nno end"))).toMatchObject({ status: 400 })
    expect(parseRelated("multipart/related; boundary=B", body("{nope", Buffer.from("x")))).toMatchObject({ status: 400 })
  })
})
