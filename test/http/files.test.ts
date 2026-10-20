/**
 * The Files APIs over loopback HTTP (since next): OpenAI's and Anthropic's `/v1/files`, Gemini's upload and `/v1beta/files`, and a
 * stored file named by `file_id` or `fileUri` on Chat, Responses, Messages and Gemini (src/files/). App isolation is the key
 * invariant (I33): another app's id is the same miss as an unknown one on every route.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { createFileState, createFileStore, type FileStore } from "../../src/files/state.js"
import { ev } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"
import { FakeStorage, clock } from "../support/usage.js"

const logs = captureLogs()
const servers: RouteServer[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
})

const KEYS = { alpha: "key-alpha", beta: "key-beta" }
type App = "alpha" | "beta"
const as = (app: App) => ({ authorization: `Bearer ${KEYS[app]}` })

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex")
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n")

async function route(options: Record<string, unknown> = {}, files?: FileStore) {
  const caller = new FakeModelCaller([ev.text("ok"), ev.finish()])
  const server = await startRoute({ caller, options: { keys: KEYS, ...options }, ...(files ? { files } : {}) })
  servers.push(server)
  return { caller, server }
}

/** A `multipart/form-data` upload, as the OpenAI and Anthropic SDKs send it. */
async function form(file: { bytes: Uint8Array; name?: string; type?: string }, fields: Record<string, string> = {}): Promise<{ body: Buffer; type: string }> {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  data.set("file", new Blob([file.bytes], file.type === undefined ? {} : { type: file.type }), file.name ?? "upload.bin")
  const encoded = new Response(data)
  // Read before the body: a consumed Response no longer reports its content type.
  const type = encoded.headers.get("content-type")!
  return { body: Buffer.from(await encoded.arrayBuffer()), type }
}

const upload = async (server: RouteServer, app: App, file: Parameters<typeof form>[0], fields: Record<string, string> = { purpose: "user_data" }, headers: Record<string, string> = {}) => {
  const { body, type } = await form(file, fields)
  return server.send({ method: "POST", path: "/v1/files", headers: { ...as(app), ...headers, "content-type": type }, body })
}
const ANTHROPIC = { "anthropic-version": "2023-06-01", "anthropic-beta": "files-api-2025-04-14" }
const get = (path: string, app: App, headers: Record<string, string> = {}, method = "GET"): SendInit => ({ method, path, headers: { ...as(app), ...headers } })

describe("OpenAI Files", () => {
  test("upload, retrieve, list, download and delete, in OpenAI's shapes", async () => {
    const { server } = await route()
    const created = await upload(server, "alpha", { bytes: PNG, name: "pixel.png", type: "image/png" })
    expect(created.status).toBe(200)
    const file = created.json()
    expect(file).toMatchObject({ object: "file", bytes: PNG.length, filename: "pixel.png", purpose: "user_data", status: "processed" })
    expect(file.id).toMatch(/^file-[0-9a-f]{32}$/)
    expect(file.expires_at - file.created_at).toBe(30 * 86_400)

    expect((await server.send(get(`/v1/files/${file.id}`, "alpha"))).json()).toEqual(file)
    const listed = (await server.send(get("/v1/files", "alpha"))).json()
    expect(listed).toEqual({ object: "list", data: [file], first_id: file.id, last_id: file.id, has_more: false })

    const content = await server.send(get(`/v1/files/${file.id}/content`, "alpha"))
    expect(content.status).toBe(200)
    expect(content.headers["content-type"]).toBe("image/png")
    expect(content.headers["content-disposition"]).toContain("attachment")
    expect(content.headers["x-content-type-options"]).toBe("nosniff")
    expect(Buffer.from(content.text, "latin1").length).toBeGreaterThan(0)

    expect((await server.send(get(`/v1/files/${file.id}`, "alpha", {}, "DELETE"))).json()).toEqual({ id: file.id, object: "file", deleted: true })
    const gone = await server.send(get(`/v1/files/${file.id}`, "alpha"))
    expect(gone.status).toBe(404)
    expect(gone.json().error).toMatchObject({ type: "invalid_request_error" })
    expect((await server.send(get(`/v1/files/${file.id}`, "alpha", {}, "DELETE"))).status).toBe(404)
  })

  test("the download is the exact bytes, as an attachment: an uploaded HTML file is never rendered", async () => {
    const { server } = await route()
    const html = Buffer.from("<script>alert(1)</script>")
    const file = (await upload(server, "alpha", { bytes: html, name: 'evil"\n.html', type: "text/html" })).json()
    const content = await server.send(get(`/v1/files/${file.id}/content`, "alpha"))
    expect(content.text).toBe(html.toString())
    expect(content.headers["content-type"]).toBe("text/html; charset=utf-8")
    expect(content.headers["content-disposition"]).toMatch(/^attachment; filename="[^"\r\n]*"; filename\*=UTF-8''/)
    expect(content.headers["content-security-policy"]).toContain("sandbox")
    expect(content.headers["x-content-type-options"]).toBe("nosniff")
  })

  test("purpose is required and checked; a missing file part or a non-multipart body is a 400", async () => {
    const { server } = await route()
    const noPurpose = await upload(server, "alpha", { bytes: PNG }, {})
    expect(noPurpose.status).toBe(400)
    expect(noPurpose.json().error).toMatchObject({ code: "missing_required_parameter", param: "purpose" })
    const wrong = await upload(server, "alpha", { bytes: PNG }, { purpose: "fine-tune" })
    expect(wrong.json().error).toMatchObject({ code: "invalid_value", param: "purpose" })
    const json = await server.send({ method: "POST", path: "/v1/files", headers: as("alpha"), body: { purpose: "user_data" } })
    expect(json.status).toBe(400)
    expect(json.json().error.code).toBe("unsupported_media_type")
  })

  test("list takes purpose, limit, after and order", async () => {
    const { server } = await route()
    const ids: string[] = []
    for (const [index, purpose] of ["user_data", "vision", "user_data", "vision"].entries())
      ids.push((await upload(server, "alpha", { bytes: Buffer.from(`note ${index}`), name: `n${index}.txt`, type: "text/plain" }, { purpose })).json().id)
    const page = (await server.send(get("/v1/files?limit=2", "alpha"))).json()
    expect(page.data.map((f: { id: string }) => f.id)).toEqual([ids[3], ids[2]])
    expect(page).toMatchObject({ has_more: true, first_id: ids[3], last_id: ids[2] })
    const next = (await server.send(get(`/v1/files?limit=2&after=${ids[2]}`, "alpha"))).json()
    expect(next.data.map((f: { id: string }) => f.id)).toEqual([ids[1], ids[0]])
    expect(next.has_more).toBe(false)
    expect((await server.send(get("/v1/files?order=asc&purpose=vision", "alpha"))).json().data.map((f: { id: string }) => f.id)).toEqual([ids[1], ids[3]])
    expect((await server.send(get("/v1/files?limit=0", "alpha"))).status).toBe(400)
    expect((await server.send(get("/v1/files?order=sideways", "alpha"))).status).toBe(400)
    expect((await server.send(get("/v1/files?after=file-nope", "alpha"))).status).toBe(400)
  })
})

describe("Anthropic Files", () => {
  test("a request with anthropic-version gets Anthropic's objects, paging and errors", async () => {
    const { server } = await route()
    const created = await upload(server, "alpha", { bytes: PDF, name: "doc.pdf", type: "application/pdf" }, {}, ANTHROPIC)
    expect(created.status).toBe(200)
    const file = created.json()
    expect(file).toMatchObject({ type: "file", filename: "doc.pdf", mime_type: "application/pdf", size_bytes: PDF.length, downloadable: true })
    expect(file.id).toMatch(/^file-[0-9a-f]{32}$/)
    expect(new Date(file.created_at).toISOString()).toBe(file.created_at)
    expect(file.purpose).toBeUndefined()

    expect((await server.send(get(`/v1/files/${file.id}?beta=true`, "alpha", ANTHROPIC))).json()).toEqual(file)
    const two = (await upload(server, "alpha", { bytes: PNG, name: "p.png" }, {}, ANTHROPIC)).json()
    const three = (await upload(server, "alpha", { bytes: Buffer.from("hello"), name: "h.txt", type: "text/plain" }, {}, ANTHROPIC)).json()

    // Newest first, 2 per page, `next_page` and `after_id` both continue.
    const first = (await server.send(get("/v1/files?beta=true&limit=2", "alpha", ANTHROPIC))).json()
    expect(first.data.map((f: { id: string }) => f.id)).toEqual([three.id, two.id])
    expect(first).toMatchObject({ has_more: true, first_id: three.id, last_id: two.id })
    expect(first.next_page).toBe(`page_${two.id}`)
    const second = (await server.send(get(`/v1/files?limit=2&page=${first.next_page}`, "alpha", ANTHROPIC))).json()
    expect(second.data.map((f: { id: string }) => f.id)).toEqual([file.id])
    expect(second).toMatchObject({ has_more: false, next_page: null })
    expect((await server.send(get(`/v1/files?after_id=${three.id}`, "alpha", ANTHROPIC))).json().data.map((f: { id: string }) => f.id)).toEqual([two.id, file.id])
    expect((await server.send(get(`/v1/files?before_id=${file.id}&limit=1`, "alpha", ANTHROPIC))).json().data.map((f: { id: string }) => f.id)).toEqual([two.id])
    expect((await server.send(get(`/v1/files?ids=${file.id}&ids=${three.id}`, "alpha", ANTHROPIC))).json().data.map((f: { id: string }) => f.id)).toEqual([three.id, file.id])
    const bad = await server.send(get("/v1/files?limit=5000", "alpha", ANTHROPIC))
    expect(bad.status).toBe(400)
    expect(bad.json()).toMatchObject({ type: "error", error: { type: "invalid_request_error" } })

    expect((await server.send(get(`/v1/files/${file.id}`, "alpha", ANTHROPIC, "DELETE"))).json()).toEqual({ id: file.id, type: "file_deleted" })
    const gone = await server.send(get(`/v1/files/${file.id}`, "alpha", ANTHROPIC))
    expect(gone.status).toBe(404)
    expect(gone.json()).toMatchObject({ type: "error", error: { type: "not_found_error" } })
  })

  test("x-api-key authenticates, and the files are the app's whichever API stored them", async () => {
    const { server } = await route()
    const viaOpenAi = (await upload(server, "alpha", { bytes: PNG, name: "p.png" })).json()
    const read = await server.send({ path: `/v1/files/${viaOpenAi.id}`, headers: { "x-api-key": KEYS.alpha, ...ANTHROPIC } })
    expect(read.status).toBe(200)
    expect(read.json()).toMatchObject({ type: "file", id: viaOpenAi.id, mime_type: "image/png" })
  })
})

describe("what is accepted", () => {
  test("the type is decided from the bytes: a declared type never makes a file an image, and an image is an image whatever it is called", async () => {
    const { server } = await route()
    expect((await upload(server, "alpha", { bytes: Buffer.from("not an image"), name: "x.png", type: "image/png" })).status).toBe(400)
    expect((await upload(server, "alpha", { bytes: Buffer.from("MZ binary\u0000\u0001"), name: "x.exe", type: "application/octet-stream" })).status).toBe(400)
    expect((await upload(server, "alpha", { bytes: Buffer.from([0xff, 0xfe, 0x41, 0x42]), name: "x.txt", type: "text/plain" })).status).toBe(400)
    expect((await upload(server, "alpha", { bytes: Buffer.alloc(0), name: "empty.txt", type: "text/plain" })).status).toBe(400)
    expect((await upload(server, "alpha", { bytes: Buffer.from("{broken"), name: "x.json", type: "application/json" })).status).toBe(400)
    const refused = (await upload(server, "alpha", { bytes: Buffer.from("not an image"), name: "x.png", type: "image/png" })).json()
    expect(refused.error).toMatchObject({ type: "invalid_request_error", code: "invalid_file", param: "file" })
    expect(refused.error.message).toContain("PNG, JPEG, GIF and WebP")

    const disguised = (await upload(server, "alpha", { bytes: PNG, name: "notes.txt", type: "text/plain" })).json()
    expect((await server.send(get(`/v1/files/${disguised.id}/content`, "alpha"))).headers["content-type"]).toBe("image/png")
    const pdf = (await upload(server, "alpha", { bytes: PDF, name: "d", type: "application/octet-stream" })).json()
    expect((await server.send(get(`/v1/files/${pdf.id}/content`, "alpha"))).headers["content-type"]).toBe("application/pdf")
    const named = (await upload(server, "alpha", { bytes: Buffer.from("a,b\n1,2\n"), name: "data.csv", type: "application/octet-stream" })).json()
    expect((await server.send(get(`/v1/files/${named.id}/content`, "alpha"))).headers["content-type"]).toBe("text/csv; charset=utf-8")
    const json = (await upload(server, "alpha", { bytes: Buffer.from('{"a":1}'), name: "d.json", type: "application/json; charset=utf-8" })).json()
    expect((await server.send(get(`/v1/files/${json.id}/content`, "alpha"))).headers["content-type"]).toBe("application/json; charset=utf-8")
  })

  test("a file over the app's body cap is a 413; text over 4 MiB is a 400 that says why", async () => {
    const { server } = await route({ limits: { maxBodyBytes: 4096 } })
    const big = await upload(server, "alpha", { bytes: Buffer.alloc(8192, 0x61), name: "big.txt", type: "text/plain" })
    expect(big.status).toBe(413)
    expect(big.json().error).toMatchObject({ code: "request_body_too_large" })
    const roomy = await route({ limits: { maxBodyBytes: 6 * 1024 * 1024 } })
    const text = await upload(roomy.server, "alpha", { bytes: Buffer.alloc(5 * 1024 * 1024, 0x61), name: "big.txt", type: "text/plain" })
    expect(text.status).toBe(400)
    expect(text.json().error.message).toContain("4 MiB")
  })

  test("an app past its file count or byte budget is refused, and nothing is evicted", async () => {
    const storage = new FakeStorage()
    const files = createFileStore({ storage, state: createFileState(), limits: { maxFiles: 2, maxAppBytes: 100 } })
    const { server } = await route({}, files)
    const a = await upload(server, "alpha", { bytes: Buffer.from("one"), name: "a.txt", type: "text/plain" })
    const b = await upload(server, "alpha", { bytes: Buffer.from("two"), name: "b.txt", type: "text/plain" })
    expect([a.status, b.status]).toEqual([200, 200])
    const c = await upload(server, "alpha", { bytes: Buffer.from("three"), name: "c.txt", type: "text/plain" })
    expect(c.status).toBe(400)
    expect(c.json().error.code).toBe("file_limit_exceeded")
    expect((await server.send(get(`/v1/files/${a.json().id}`, "alpha"))).status).toBe(200)
    // Another app has its own budget.
    expect((await upload(server, "beta", { bytes: Buffer.from("three"), name: "c.txt", type: "text/plain" })).status).toBe(200)
    await server.send(get(`/v1/files/${a.json().id}`, "alpha", {}, "DELETE"))
    const heavy = await upload(server, "alpha", { bytes: Buffer.alloc(120, 0x61), name: "h.txt", type: "text/plain" })
    expect(heavy.json().error.code).toBe("file_storage_full")
  })
})

describe("I33 app isolation", () => {
  test("another app's file id is the same 404 as an unknown one, on every route and every API", async () => {
    const { server } = await route()
    const mine = (await upload(server, "alpha", { bytes: PNG, name: "mine.png" })).json()
    const unknown = `file-${"1".repeat(32)}`
    for (const [method, path] of [
      ["GET", `/v1/files/${mine.id}`],
      ["GET", `/v1/files/${mine.id}/content`],
      ["DELETE", `/v1/files/${mine.id}`],
    ] as const) {
      const theirs = await server.send(get(path, "beta", {}, method))
      const missing = await server.send(get(path.replace(mine.id, unknown), "beta", {}, method))
      expect(theirs.status).toBe(404)
      expect(theirs.text.replace(mine.id, "ID")).toBe(missing.text.replace(unknown, "ID"))
      const anthropic = await server.send(get(path, "beta", ANTHROPIC, method))
      expect(anthropic.status).toBe(404)
      expect(anthropic.text.replace(mine.id, "ID")).toBe((await server.send(get(path.replace(mine.id, unknown), "beta", ANTHROPIC, method))).text.replace(unknown, "ID"))
    }
    const name = `files/${mine.id.slice(5)}`
    const geminiTheirs = await server.send(get(`/v1beta/${name}`, "beta"))
    expect(geminiTheirs.status).toBe(404)
    expect((await server.send(get(`/v1beta/${name}`, "beta", {}, "DELETE"))).status).toBe(404)
    expect((await server.send(get("/v1/files", "beta"))).json().data).toEqual([])
    expect((await server.send(get("/v1beta/files", "beta"))).json()).toEqual({})
    // The owner's file is untouched by all of it.
    expect((await server.send(get(`/v1/files/${mine.id}`, "alpha"))).status).toBe(200)
  })

  test("another app's file named in a request is a 404 on Chat, Responses, Messages and Gemini, and the model is never called", async () => {
    const { server, caller } = await route()
    const mine = (await upload(server, "alpha", { bytes: PNG, name: "mine.png" })).json()
    const name = `files/${mine.id.slice(5)}`
    const replies = await Promise.all([
      server.send({
        method: "POST",
        path: "/v1/chat/completions",
        headers: as("beta"),
        body: { model: "test/echo", messages: [{ role: "user", content: [{ type: "file", file: { file_id: mine.id } }] }] },
      }),
      server.send({ method: "POST", path: "/v1/responses", headers: as("beta"), body: { model: "test/echo", input: [{ role: "user", content: [{ type: "input_image", file_id: mine.id }] }] } }),
      server.send({
        method: "POST",
        path: "/v1/messages",
        headers: as("beta"),
        body: { model: "test/echo", max_tokens: 10, messages: [{ role: "user", content: [{ type: "image", source: { type: "file", file_id: mine.id } }] }] },
      }),
      server.send({ method: "POST", path: "/v1beta/models/test%2Fecho:generateContent", headers: as("beta"), body: { contents: [{ parts: [{ fileData: { fileUri: name } }] }] } }),
    ])
    expect(replies.map((reply) => reply.status)).toEqual([404, 404, 404, 404])
    expect(replies[0]!.json().error).toMatchObject({ type: "invalid_request_error" })
    expect(replies[2]!.json().error.type).toBe("not_found_error")
    expect(replies[3]!.json().error.status).toBe("NOT_FOUND")
    expect(caller.calls).toEqual([])
  })

  test("#547 a missing file is the same 404 body on the Files route and in a request, on the OpenAI and Anthropic routes", async () => {
    const { server } = await route()
    const id = `file-${"1".repeat(32)}`
    const route404 = (await server.send(get(`/v1/files/${id}`, "alpha"))).json()
    expect(route404).toEqual({ error: { message: `No such File object: ${id}`, type: "invalid_request_error", param: null, code: null } })
    const chat = await server.send({
      method: "POST",
      path: "/v1/chat/completions",
      headers: as("alpha"),
      body: { model: "test/echo", messages: [{ role: "user", content: [{ type: "file", file: { file_id: id } }] }] },
    })
    const responses = await server.send({
      method: "POST",
      path: "/v1/responses",
      headers: as("alpha"),
      body: { model: "test/echo", input: [{ role: "user", content: [{ type: "input_file", file_id: id }] }] },
    })
    expect(chat.status).toBe(404)
    expect(chat.json()).toEqual(route404)
    expect(responses.status).toBe(404)
    expect(responses.json()).toEqual(route404)

    const anthropicRoute = (await server.send(get(`/v1/files/${id}`, "alpha", ANTHROPIC))).json()
    const messages = await server.send({
      method: "POST",
      path: "/v1/messages",
      headers: as("alpha"),
      body: { model: "test/echo", max_tokens: 10, messages: [{ role: "user", content: [{ type: "image", source: { type: "file", file_id: id } }] }] },
    })
    expect(messages.status).toBe(404)
    expect(messages.json()).toEqual(anthropicRoute)
    expect(anthropicRoute.error).toMatchObject({ type: "not_found_error", message: `File not found: ${id}` })
  })

  test("a malformed id is a miss too, and no key outside the app's prefix can be reached through it", async () => {
    const { server } = await route()
    for (const id of ["../../keys/x", "file-", "FILE-" + "a".repeat(32), "file-" + "g".repeat(32), "%2e%2e%2fresponses"]) expect((await server.send(get(`/v1/files/${id}`, "alpha"))).status).toBe(404)
  })
})

describe("retention, restart and logs", () => {
  const DAY = 86_400_000

  test("a file is kept for the app's history retention (30 days by default), then it is a 404 and gone from storage", async () => {
    const storage = new FakeStorage()
    const time = clock("2026-10-17T00:00:00Z")
    const files = createFileStore({ storage, state: createFileState(), now: () => time.at })
    const { server } = await route({ sessions: { maxAgeDays: 0 }, apps: { beta: { sessions: { maxAgeDays: 2 } } } }, files)
    const a = (await upload(server, "alpha", { bytes: PNG, name: "a.png" })).json()
    const b = (await upload(server, "beta", { bytes: PNG, name: "b.png" })).json()
    time.at += 3 * DAY
    expect((await server.send(get(`/v1/files/${a.id}`, "alpha"))).status).toBe(200)
    expect((await server.send(get(`/v1/files/${b.id}`, "beta"))).status).toBe(404)
    expect([...storage.values.keys()].filter((key) => key.includes(`/${b.id}`) && key.startsWith("files/beta"))).toEqual([])
    time.at += 28 * DAY
    expect((await server.send(get(`/v1/files/${a.id}`, "alpha"))).status).toBe(404)
    expect((await server.send(get("/v1/files", "alpha"))).json().data).toEqual([])
    expect([...storage.values.keys()].filter((key) => key.startsWith("files/"))).toEqual([])
  })

  test("a sweep from request handling deletes expired files that nobody read again", async () => {
    const storage = new FakeStorage()
    const time = clock("2026-10-17T00:00:00Z")
    const files = createFileStore({ storage, state: createFileState(), now: () => time.at })
    const { server } = await route({}, files)
    for (let i = 0; i < 3; i++) await upload(server, "alpha", { bytes: Buffer.from(`old ${i}`), name: `o${i}.txt`, type: "text/plain" })
    time.at += 31 * DAY
    await upload(server, "alpha", { bytes: Buffer.from("fresh"), name: "fresh.txt", type: "text/plain" })
    await files.idle()
    const left = [...storage.values.keys()].filter((key) => key.startsWith("files/alpha/id/"))
    expect(left).toHaveLength(1)
    expect((await server.send(get("/v1/files", "alpha"))).json().data.map((f: { filename: string }) => f.filename)).toEqual(["fresh.txt"])
  })

  test("a file survives a restart: a new server on the same storage reads it, lists it and uses it", async () => {
    const storage = new FakeStorage()
    const first = await route({}, createFileStore({ storage, state: createFileState() }))
    const file = (await upload(first.server, "alpha", { bytes: PDF, name: "kept.pdf", type: "application/pdf" })).json()
    await first.server.close()
    servers.splice(servers.indexOf(first.server), 1)

    const second = await route({}, createFileStore({ storage, state: createFileState() }))
    expect((await second.server.send(get(`/v1/files/${file.id}`, "alpha"))).json()).toEqual(file)
    expect((await second.server.send(get("/v1beta/files", "alpha"))).json().files).toHaveLength(1)
    const used = await second.server.send({
      method: "POST",
      path: "/v1/chat/completions",
      headers: as("alpha"),
      body: { model: "test/echo", messages: [{ role: "user", content: [{ type: "file", file: { file_id: file.id } }] }] },
    })
    expect(used.status).toBe(200)
  })

  test("I33 no file id, name or content reaches a log line, and the routes are logged under their templates", async () => {
    const storage = new FakeStorage()
    const { server } = await route({}, createFileStore({ storage, state: createFileState() }))
    const mine = (await upload(server, "alpha", { bytes: Buffer.from("private words"), name: "secret-name.txt", type: "text/plain" })).json()
    const missing = `file-${"3".repeat(32)}`
    await server.send(get(`/v1/files/${mine.id}`, "alpha"))
    await server.send(get(`/v1/files/${mine.id}/content`, "alpha"))
    await server.send(get(`/v1/files/${mine.id}`, "beta"))
    await server.send(get(`/v1/files/${missing}`, "beta"))
    await server.send(get(`/v1beta/files/${mine.id.slice(5)}`, "alpha"))
    await server.send(get("/v1/files", "alpha"))
    storage.failPuts = true
    await server.send(get(`/v1/files/${mine.id}`, "alpha", {}, "DELETE"))
    await upload(server, "alpha", { bytes: Buffer.from("more private words"), name: "secret-two.txt", type: "text/plain" })
    const text = logs.lines.map((line) => line.raw).join("\n")
    expect(logs.of("request").length).toBeGreaterThan(5)
    expect(text).not.toContain(mine.id)
    expect(text).not.toContain(mine.id.slice(5))
    expect(text).not.toContain(missing)
    expect(text).not.toContain("private words")
    expect(text).not.toContain("secret-name")
    expect(text).not.toContain("secret-two")
    expect(logs.of("request").map((line) => line.fields.route)).toEqual(
      expect.arrayContaining(["POST /v1/files", "GET /v1/files", "GET /v1/files/{id}", "GET /v1/files/{id}/content", "DELETE /v1/files/{id}", "GET /v1beta/files/{name}"]),
    )
  })
})

describe("failures keep each API's error shape", () => {
  /** A store whose reads never answer, so the request deadline decides. */
  const hanging = (): FileStore => ({ ...createFileStore({ storage: new FakeStorage(), state: createFileState() }), head: () => new Promise(() => {}) })
  const FAST = { requestTimeoutMs: 80 }

  test("a storage failure is a generic 500 in OpenAI's, Anthropic's and Google's body, and the log keeps the cause out of the answer", async () => {
    const storage = new FakeStorage()
    const { server } = await route({}, createFileStore({ storage, state: createFileState() }))
    storage.failPuts = true
    const openai = await upload(server, "alpha", { bytes: PNG, name: "p.png" })
    expect(openai.status).toBe(500)
    expect(openai.json().error.message).toBe("Internal server error")
    const anthropic = await upload(server, "alpha", { bytes: PNG, name: "p.png" }, {}, ANTHROPIC)
    expect(anthropic.status).toBe(500)
    expect(anthropic.json()).toMatchObject({ type: "error", error: { message: "Internal server error" } })
    const start = await server.send({
      method: "POST",
      path: "/upload/v1beta/files",
      headers: { "x-goog-api-key": KEYS.alpha, "x-goog-upload-protocol": "resumable", "x-goog-upload-command": "start" },
      body: {},
    })
    const path = new URL(String(start.headers["x-goog-upload-url"]))
    const google = await server.send({
      method: "POST",
      path: path.pathname + path.search,
      headers: { "x-goog-api-key": KEYS.alpha, "x-goog-upload-command": "upload, finalize", "content-type": "application/octet-stream" },
      body: PNG,
    })
    expect(google.status).toBe(500)
    expect(google.json().error).toMatchObject({ code: 500, message: "Internal server error" })
  })

  test("a request that outlives its deadline is a 504 in each API's body", async () => {
    const { server } = await route(FAST, hanging())
    const openai = await server.send(get("/v1/files/file-" + "a".repeat(32), "alpha"))
    expect(openai.status).toBe(504)
    expect(openai.json().error.type).toBe("timeout_error")
    const anthropic = await server.send(get("/v1/files/file-" + "a".repeat(32), "alpha", ANTHROPIC))
    expect(anthropic.status).toBe(504)
    expect(anthropic.json()).toMatchObject({ type: "error" })
    const google = await server.send(get("/v1beta/files/" + "a".repeat(32), "alpha"))
    expect(google.status).toBe(504)
    expect(google.json().error.code).toBe(504)
  })
})

describe("#544 the Gemini upload URL and file uri name an address the caller can reach", () => {
  /** Starts a resumable upload and, unless `keep`, cancels it: unfinished uploads are process-wide and capped per app, so a test must not leave one behind. */
  const startUpload = async (server: RouteServer, host: string, extra: Record<string, string> = {}, keep = false) => {
    const start = await server.send({
      method: "POST",
      path: "/upload/v1beta/files",
      headers: { "x-goog-api-key": KEYS.alpha, "x-goog-upload-protocol": "resumable", "x-goog-upload-command": "start", host, ...extra },
      body: {},
    })
    if (!keep) {
      const url = new URL(String(start.headers["x-goog-upload-url"]))
      const cancelled = await server.send({ method: "POST", path: url.pathname + url.search, headers: { "x-goog-api-key": KEYS.alpha, "x-goog-upload-command": "cancel", host }, body: {} })
      expect(cancelled.status).toBe(200)
    }
    return start
  }

  async function wildcard(options: Record<string, unknown> = {}) {
    const server = await startRoute({ caller: new FakeModelCaller([ev.finish()]), options: { keys: KEYS, ...options }, listenHost: "0.0.0.0" })
    servers.push(server)
    return server
  }

  test("on a wildcard bind the upload URL and the file uri use the Host the caller used, never 0.0.0.0", async () => {
    const server = await wildcard()
    const start = await startUpload(server, "192.0.2.10:4010")
    expect(String(start.headers["x-goog-upload-url"])).toMatch(/^http:\/\/192\.0\.2\.10:4010\/upload\/v1beta\/files\?upload_id=[0-9a-f]{32}&upload_protocol=resumable$/)
    const mine = (await upload(server, "alpha", { bytes: PNG, name: "p.png" })).json()
    const meta = await server.send({ path: `/v1beta/files/${mine.id.slice(5)}`, headers: { "x-goog-api-key": KEYS.alpha, host: "opencode.example" } })
    expect(meta.json().uri).toBe(`http://opencode.example/v1beta/files/${mine.id.slice(5)}`)
  })

  test("the chunk upload to that URL works and the finalizing answer carries the same address", async () => {
    const server = await wildcard()
    const start = await startUpload(server, "192.0.2.10:4010", {}, true)
    const url = new URL(String(start.headers["x-goog-upload-url"]))
    const done = await server.send({
      method: "POST",
      path: url.pathname + url.search,
      headers: { "x-goog-api-key": KEYS.alpha, "x-goog-upload-command": "upload, finalize", "content-type": "application/octet-stream", host: "192.0.2.10:4010" },
      body: PNG,
    })
    expect(done.status).toBe(200)
    expect(done.json().file.uri).toMatch(/^http:\/\/192\.0\.2\.10:4010\/v1beta\/files\/[0-9a-f]{32}$/)
  })

  test("a trusted proxy's public origin wins over the Host header", async () => {
    const server = await wildcard({ listen: { trustProxy: ["127.0.0.1"] } })
    const start = await startUpload(server, "192.0.2.10:4010", { "x-forwarded-host": "files.example.net", "x-forwarded-proto": "https" })
    expect(String(start.headers["x-goog-upload-url"])).toStartWith("https://files.example.net/upload/v1beta/files?")
  })

  test("a Host that is not a plain host falls back to the listen address", async () => {
    const server = await wildcard()
    const start = await startUpload(server, "0.0.0.0:4010")
    expect(String(start.headers["x-goog-upload-url"])).toStartWith(`http://0.0.0.0:${server.port}/upload/v1beta/files?`)
  })

  test("a specific listen address ignores the Host header", async () => {
    const server = await startRoute({ caller: new FakeModelCaller([ev.finish()]), options: { keys: KEYS }, listenHost: "192.0.2.10" })
    servers.push(server)
    const start = await startUpload(server, "other.example:4010")
    expect(String(start.headers["x-goog-upload-url"])).toStartWith(`http://192.0.2.10:${server.port}/upload/v1beta/files?`)
  })
})

describe("endpoints", () => {
  test("`files` is an endpoint of apps.<name>.endpoints: without it every Files route is a 403 endpoint_forbidden, and with it only those", async () => {
    const { server } = await route({ apps: { alpha: { endpoints: ["chat"] }, beta: { endpoints: ["files"] } } })
    for (const init of [
      get("/v1/files", "alpha"),
      get("/v1/files", "alpha", ANTHROPIC),
      get("/v1beta/files", "alpha"),
      get("/v1beta/files/" + "a".repeat(32), "alpha"),
      { method: "POST", path: "/upload/v1beta/files", headers: { ...as("alpha"), "x-goog-upload-protocol": "resumable", "x-goog-upload-command": "start" }, body: {} },
    ] as SendInit[]) {
      const reply = await server.send(init)
      expect(reply.status).toBe(403)
      // OpenAI's and Anthropic's bodies carry the code; Google's names the endpoint in the message.
      expect(JSON.stringify(reply.json())).toMatch(/endpoint_forbidden|may not call the files endpoint/)
    }
    expect((await server.send(get("/v1/files", "beta"))).status).toBe(200)
    expect((await server.send({ method: "POST", path: "/v1/chat/completions", headers: as("beta"), body: { model: "test/echo", messages: [{ role: "user", content: "hi" }] } })).status).toBe(403)
  })

  test("unauthenticated callers get a 401 on every Files route", async () => {
    const { server } = await route()
    for (const [method, path] of [
      ["GET", "/v1/files"],
      ["POST", "/v1/files"],
      ["GET", "/v1/files/file-x"],
      ["GET", "/v1beta/files"],
      ["POST", "/upload/v1beta/files"],
    ] as const)
      expect((await server.send({ method, path })).status).toBe(401)
  })
})

describe("a stored file in a request reaches the model as the inline form does", () => {
  const dataUrl = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString("base64")}`

  test("Chat Completions: an image, a PDF and a text file by file_id", async () => {
    const { server, caller } = await route()
    const image = (await upload(server, "alpha", { bytes: PNG, name: "p.png" })).json()
    const pdf = (await upload(server, "alpha", { bytes: PDF, name: "d.pdf", type: "application/pdf" })).json()
    const text = (await upload(server, "alpha", { bytes: Buffer.from("plain words"), name: "t.txt", type: "text/plain" })).json()
    const reply = await server.send({
      method: "POST",
      path: "/v1/chat/completions",
      headers: as("alpha"),
      body: {
        model: "test/echo",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "look" },
              { type: "file", file: { file_id: image.id } },
              { type: "file", file: { file_id: pdf.id } },
              { type: "file", file: { file_id: text.id } },
            ],
          },
        ],
      },
    })
    expect(reply.status).toBe(200)
    expect(caller.calls[0]!.request.messages[0]!.content).toEqual([
      { type: "text", text: "look" },
      { type: "media", url: dataUrl("image/png", PNG), mediaType: "image/png" },
      { type: "media", url: dataUrl("application/pdf", PDF), mediaType: "application/pdf" },
      { type: "text", text: "plain words" },
    ])
  })

  test("Responses: input_file and input_image by file_id; a stored response keeps the file_id, not the bytes", async () => {
    const { server, caller } = await route()
    const image = (await upload(server, "alpha", { bytes: PNG, name: "p.png" })).json()
    const pdf = (await upload(server, "alpha", { bytes: PDF, name: "d.pdf", type: "application/pdf" })).json()
    const reply = await server.send({
      method: "POST",
      path: "/v1/responses",
      headers: as("alpha"),
      body: {
        model: "test/echo",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: "look" },
              { type: "input_image", file_id: image.id },
              { type: "input_file", file_id: pdf.id },
            ],
          },
        ],
      },
    })
    expect(reply.status).toBe(200)
    expect(caller.calls[0]!.request.messages[0]!.content).toEqual([
      { type: "text", text: "look" },
      { type: "media", url: dataUrl("image/png", PNG), mediaType: "image/png" },
      { type: "media", url: dataUrl("application/pdf", PDF), mediaType: "application/pdf" },
    ])
    const items = (await server.send(get(`/v1/responses/${reply.json().id}/input_items?order=asc`, "alpha"))).json()
    expect(items.data[0].content).toEqual([
      { type: "input_text", text: "look" },
      { type: "input_image", file_id: image.id },
      { type: "input_file", file_id: pdf.id },
    ])
    // A later turn chained on it sees the files again.
    const next = await server.send({ method: "POST", path: "/v1/responses", headers: as("alpha"), body: { model: "test/echo", input: "and now?", previous_response_id: reply.json().id } })
    expect(next.status).toBe(200)
    expect(caller.calls[1]!.request.messages[0]!.content.map((part) => part.type)).toEqual(["text", "media", "media"])
    // An input_image cannot be a PDF.
    const wrong = await server.send({
      method: "POST",
      path: "/v1/responses",
      headers: as("alpha"),
      body: { model: "test/echo", input: [{ role: "user", content: [{ type: "input_image", file_id: pdf.id }] }] },
    })
    expect(wrong.status).toBe(400)
    expect(wrong.json().error.code).toBe("invalid_file")
  })

  test("Messages: image and document blocks with a file source keep their other fields; a wrong kind is a 400", async () => {
    const { server, caller } = await route()
    const image = (await upload(server, "alpha", { bytes: PNG, name: "p.png" }, {}, ANTHROPIC)).json()
    const pdf = (await upload(server, "alpha", { bytes: PDF, name: "d.pdf", type: "application/pdf" }, {}, ANTHROPIC)).json()
    const text = (await upload(server, "alpha", { bytes: Buffer.from("plain words"), name: "t.txt", type: "text/plain" }, {}, ANTHROPIC)).json()
    const reply = await server.send({
      method: "POST",
      path: "/v1/messages",
      headers: as("alpha"),
      body: {
        model: "test/echo",
        max_tokens: 10,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "file", file_id: image.id } },
              { type: "document", source: { type: "file", file_id: pdf.id }, cache_control: { type: "ephemeral" } },
              { type: "document", source: { type: "file", file_id: text.id } },
            ],
          },
        ],
      },
    })
    expect(reply.status).toBe(200)
    const content = caller.calls[0]!.request.messages[0]!.content
    expect(content[0]).toEqual({ type: "media", url: dataUrl("image/png", PNG), mediaType: "image/png" })
    expect(content[1]).toEqual({ type: "media", url: dataUrl("application/pdf", PDF), mediaType: "application/pdf", cache: true })
    expect(content[2]).toEqual({ type: "text", text: "plain words" })
    const wrong = await server.send({
      method: "POST",
      path: "/v1/messages",
      headers: as("alpha"),
      body: { model: "test/echo", max_tokens: 10, messages: [{ role: "user", content: [{ type: "image", source: { type: "file", file_id: pdf.id } }] }] },
    })
    expect(wrong.status).toBe(400)
    expect(wrong.json().error.type).toBe("invalid_request_error")
    // The count route resolves them too.
    const counted = await server.send({
      method: "POST",
      path: "/v1/messages/count_tokens",
      headers: as("alpha"),
      body: { model: "test/echo", messages: [{ role: "user", content: [{ type: "image", source: { type: "file", file_id: image.id } }] }] },
    })
    expect(counted.status).toBe(200)
  })

  test("Gemini: fileData.fileUri as files/<id> and as the uri an upload returned", async () => {
    const { server, caller } = await route()
    const pdf = (await upload(server, "alpha", { bytes: PDF, name: "d.pdf", type: "application/pdf" })).json()
    const gemini = (await server.send(get(`/v1beta/files/${pdf.id.slice(5)}`, "alpha"))).json()
    expect(gemini.uri).toMatch(/\/v1beta\/files\/[0-9a-f]{32}$/)
    for (const fileUri of [gemini.name, gemini.uri]) {
      const reply = await server.send({
        method: "POST",
        path: "/v1beta/models/test%2Fecho:generateContent",
        headers: as("alpha"),
        body: { contents: [{ parts: [{ text: "look" }, { fileData: { fileUri, mimeType: "application/pdf" } }] }] },
      })
      expect(reply.status).toBe(200)
    }
    for (const call of caller.calls)
      expect(call.request.messages[0]!.content).toEqual([
        { type: "text", text: "look" },
        { type: "media", url: dataUrl("application/pdf", PDF), mediaType: "application/pdf" },
      ])
    // An http uri that is not ours is still fetched as before (off by default: a 4xx from the image filter, never a file lookup).
    const remote = await server.send({
      method: "POST",
      path: "/v1beta/models/test%2Fecho:generateContent",
      headers: as("alpha"),
      body: { contents: [{ parts: [{ fileData: { fileUri: "https://example.com/p.png" } }] }] },
    })
    expect(remote.status).not.toBe(404)
  })

  test("a deleted file, an unknown id and a request naming too many files are refused before any model call", async () => {
    const { server, caller } = await route()
    const file = (await upload(server, "alpha", { bytes: PNG, name: "p.png" })).json()
    await server.send(get(`/v1/files/${file.id}`, "alpha", {}, "DELETE"))
    const chat = (id: string) => ({
      method: "POST",
      path: "/v1/chat/completions",
      headers: as("alpha"),
      body: { model: "test/echo", messages: [{ role: "user", content: [{ type: "file", file: { file_id: id } }] }] },
    })
    expect((await server.send(chat(file.id))).status).toBe(404)
    expect((await server.send(chat("file-nope"))).status).toBe(404)
    const many = { model: "test/echo", messages: [{ role: "user", content: Array.from({ length: 33 }, (_, i) => ({ type: "file", file: { file_id: `file-${String(i).padStart(32, "0")}` } })) }] }
    const reply = await server.send({ method: "POST", path: "/v1/chat/completions", headers: as("alpha"), body: many })
    expect(reply.status).toBe(400)
    expect(reply.json().error.code).toBe("too_many_files")
    expect(caller.calls).toEqual([])
  })
})
