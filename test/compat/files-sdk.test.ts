/**
 * The Files APIs against the official SDKs (since next): `openai`, `@anthropic-ai/sdk` (beta files) and `@google/genai`, each run the
 * way its docs show, upload then use by id then delete, over a real loopback listener. The SDKs parse every answer, so a
 * shape that does not match theirs fails here. `@google/genai` uploads with the resumable protocol (`X-Goog-Upload-*`), so this
 * is also the proof that protocol works end to end.
 */
import Anthropic, { toFile as anthropicFile } from "@anthropic-ai/sdk"
import { GoogleGenAI, createPartFromUri } from "@google/genai"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import OpenAI, { toFile as openaiFile } from "openai"
import { ev } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { startRoute, type RouteServer } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"
import { PDF_BASE64, PNG_BASE64 } from "./scenarios.js"

captureLogs()
const KEY = "files-sdk-key"
let server: RouteServer
let caller: FakeModelCaller
const bytes = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))

beforeAll(async () => {
  caller = new FakeModelCaller([ev.text("ok"), ev.finish()])
  server = await startRoute({ caller, options: { keys: { compat: KEY }, aliases: { fast: "test/echo" } } })
})
afterAll(() => server.close())

const lastParts = () => caller.calls.at(-1)!.request.messages[0]!.content
/** The error a call rejects with (the SDKs return lazy promises that `expect(...).rejects` does not await). */
const rejection = (call: PromiseLike<unknown>) => call.then(() => undefined, (caught: unknown) => caught as { status?: number })

describe("openai (files)", () => {
  const client = () => new OpenAI({ baseURL: `${server.url}/v1`, apiKey: KEY, maxRetries: 0 })

  test("create, retrieve, list, content and delete a PDF, and use it in Chat and Responses by file_id", async () => {
    const openai = client()
    const created = await openai.files.create({ file: await openaiFile(bytes(PDF_BASE64), "paper.pdf", { type: "application/pdf" }), purpose: "user_data" })
    expect(created).toMatchObject({ object: "file", filename: "paper.pdf", purpose: "user_data" })
    expect((await openai.files.retrieve(created.id)).id).toBe(created.id)
    const listed: string[] = []
    for await (const file of openai.files.list({ purpose: "user_data" })) listed.push(file.id)
    expect(listed).toContain(created.id)
    const content = await openai.files.content(created.id)
    expect(new Uint8Array(await content.arrayBuffer())).toEqual(bytes(PDF_BASE64))

    const chat = await openai.chat.completions.create({ model: "fast", messages: [{ role: "user", content: [{ type: "text", text: "read it" }, { type: "file", file: { file_id: created.id } }] }] })
    expect(chat.choices[0]!.message.content).toBe("ok")
    expect(lastParts()[1]).toMatchObject({ type: "media", mediaType: "application/pdf" })
    const response = await openai.responses.create({ model: "fast", input: [{ role: "user", content: [{ type: "input_text", text: "read it" }, { type: "input_file", file_id: created.id }] }] })
    expect(response.output_text).toBe("ok")
    expect(lastParts()[1]).toMatchObject({ type: "media", mediaType: "application/pdf" })

    expect(await openai.files.delete(created.id)).toMatchObject({ id: created.id, deleted: true })
    expect((await rejection(openai.files.retrieve(created.id)))?.status).toBe(404)
  })

  test("an image by file_id in Chat and in Responses", async () => {
    const openai = client()
    const created = await openai.files.create({ file: await openaiFile(bytes(PNG_BASE64), "pixel.png", { type: "image/png" }), purpose: "vision" })
    await openai.chat.completions.create({ model: "fast", messages: [{ role: "user", content: [{ type: "file", file: { file_id: created.id } }] }] })
    expect(lastParts()[0]).toMatchObject({ type: "media", mediaType: "image/png" })
    await openai.responses.create({ model: "fast", input: [{ role: "user", content: [{ type: "input_image", file_id: created.id, detail: "auto" }] }] })
    expect(lastParts()[0]).toMatchObject({ type: "media", mediaType: "image/png" })
    await openai.files.delete(created.id)
  })
})

describe("anthropic (beta files)", () => {
  const client = () => new Anthropic({ baseURL: server.url, apiKey: KEY, maxRetries: 0 })

  test("upload, metadata, list, download and delete, and use the file in a Messages image and document block", async () => {
    const anthropic = client()
    const pdf = await anthropic.beta.files.upload({ file: await anthropicFile(bytes(PDF_BASE64), "paper.pdf", { type: "application/pdf" }) })
    expect(pdf).toMatchObject({ type: "file", filename: "paper.pdf", mime_type: "application/pdf", downloadable: true })
    const image = await anthropic.beta.files.upload({ file: await anthropicFile(bytes(PNG_BASE64), "pixel.png", { type: "image/png" }) })
    expect((await anthropic.beta.files.retrieveMetadata(pdf.id)).size_bytes).toBe(bytes(PDF_BASE64).length)
    const listed: string[] = []
    for await (const file of anthropic.beta.files.list({ limit: 1 })) listed.push(file.id)
    expect(listed).toEqual([image.id, pdf.id])
    const download = await anthropic.beta.files.download(pdf.id)
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes(PDF_BASE64))

    const message = await anthropic.beta.messages.create({
      model: "fast",
      max_tokens: 16,
      betas: ["files-api-2025-04-14"],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "compare" },
            { type: "image", source: { type: "file", file_id: image.id } },
            { type: "document", source: { type: "file", file_id: pdf.id } },
          ],
        },
      ],
    })
    expect(message.content[0]).toMatchObject({ type: "text", text: "ok" })
    expect(lastParts().slice(1)).toMatchObject([{ type: "media", mediaType: "image/png" }, { type: "media", mediaType: "application/pdf" }])

    expect(await anthropic.beta.files.delete(pdf.id)).toEqual({ id: pdf.id, type: "file_deleted" })
    await anthropic.beta.files.delete(image.id)
    expect((await rejection(anthropic.beta.files.retrieveMetadata(pdf.id)))?.status).toBe(404)
  })
})

describe("google (files)", () => {
  const client = () => new GoogleGenAI({ apiKey: KEY, httpOptions: { baseUrl: server.url } })

  test("upload (resumable), get, list, delete, and generateContent with the uploaded file's uri", async () => {
    const genai = client()
    const file = await genai.files.upload({ file: new Blob([bytes(PDF_BASE64)], { type: "application/pdf" }), config: { displayName: "paper.pdf" } })
    expect(file).toMatchObject({ displayName: "paper.pdf", mimeType: "application/pdf", state: "ACTIVE", sizeBytes: String(bytes(PDF_BASE64).length) })
    expect(file.name).toMatch(/^files\/[0-9a-f]{32}$/)
    expect((await genai.files.get({ name: file.name! })).uri).toBe(file.uri)
    const names: string[] = []
    for await (const entry of await genai.files.list({ config: { pageSize: 1 } })) names.push(entry.name!)
    expect(names).toContain(file.name!)

    const answer = await genai.models.generateContent({ model: "fast", contents: [{ role: "user", parts: [{ text: "read it" }, createPartFromUri(file.uri!, file.mimeType!)] }] })
    expect(answer.text).toBe("ok")
    expect(lastParts()[1]).toMatchObject({ type: "media", mediaType: "application/pdf" })

    await genai.files.delete({ name: file.name! })
    expect((await rejection(genai.files.get({ name: file.name! })))?.status).toBe(404)
  })

  test("an image uploaded from a path-less blob is used by name, files/<id>", async () => {
    const genai = client()
    const file = await genai.files.upload({ file: new Blob([bytes(PNG_BASE64)], { type: "image/png" }) })
    await genai.models.generateContent({ model: "fast", contents: [{ role: "user", parts: [createPartFromUri(file.name!, "image/png")] }] })
    expect(lastParts()[0]).toMatchObject({ type: "media", mediaType: "image/png" })
    await genai.files.delete({ name: file.name! })
  })
})
