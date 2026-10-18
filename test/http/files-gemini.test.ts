/**
 * Gemini's Files API over loopback HTTP (since next): the resumable protocol both SDKs use, `uploadType=multipart`, and the
 * `/v1beta/files` routes, in Google's shapes. The same app isolation as the other Files APIs (I33).
 */
import { afterEach, describe, expect, test } from "bun:test"
import { ev } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"

captureLogs()
const servers: RouteServer[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
})

const KEYS = { alpha: "key-alpha", beta: "key-beta" }
type App = "alpha" | "beta"
const as = (app: App) => ({ "x-goog-api-key": KEYS[app] })
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex")
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n")

async function route(options: Record<string, unknown> = {}) {
  const caller = new FakeModelCaller([ev.text("ok"), ev.finish()])
  const server = await startRoute({ caller, options: { keys: KEYS, ...options } })
  servers.push(server)
  return { caller, server }
}

const start = (app: App, meta: object = {}, headers: Record<string, string> = {}): SendInit => ({
  method: "POST",
  path: "/upload/v1beta/files",
  headers: { ...as(app), "x-goog-upload-protocol": "resumable", "x-goog-upload-command": "start", ...headers },
  body: meta,
})

/** The path and query of the upload url a start answered (the SDKs keep them and swap the host). */
const target = (reply: { headers: Record<string, string | string[] | undefined> }) => {
  const url = new URL(String(reply.headers["x-goog-upload-url"]))
  return url.pathname + url.search
}

const chunk = (app: App, path: string, command: string, offset: number, bytes: Buffer): SendInit => ({
  method: "POST",
  path,
  headers: { ...as(app), "x-goog-upload-command": command, "x-goog-upload-offset": String(offset), "content-type": "application/octet-stream" },
  body: bytes,
})

describe("resumable upload (what @google/genai and google-genai send)", () => {
  test("start, one chunk, finalize: the answer carries the file and `x-goog-upload-status: final`", async () => {
    const { server } = await route()
    const started = await server.send(start("alpha", { file: { displayName: "doc.pdf" } }, { "x-goog-upload-header-content-length": String(PDF.length), "x-goog-upload-header-content-type": "application/pdf" }))
    expect(started.status).toBe(200)
    expect(started.headers["x-goog-upload-status"]).toBe("active")
    expect(target(started)).toMatch(/^\/upload\/v1beta\/files\?upload_id=[0-9a-f]{32}&upload_protocol=resumable$/)

    const done = await server.send(chunk("alpha", target(started), "upload, finalize", 0, PDF))
    expect(done.status).toBe(200)
    expect(done.headers["x-goog-upload-status"]).toBe("final")
    const { file } = done.json()
    expect(file).toMatchObject({ displayName: "doc.pdf", mimeType: "application/pdf", sizeBytes: String(PDF.length), state: "ACTIVE", source: "UPLOADED" })
    expect(file.name).toMatch(/^files\/[0-9a-f]{32}$/)
    expect(file.uri).toMatch(new RegExp(`/v1beta/${file.name}$`))
    expect(new Date(file.createTime).toISOString()).toBe(file.createTime)
    expect(new Date(file.expirationTime).getTime() - new Date(file.createTime).getTime()).toBe(30 * 86_400_000)

    expect((await server.send({ path: `/v1beta/${file.name}`, headers: as("alpha") })).json()).toEqual(file)
    expect((await server.send({ path: "/v1beta/files", headers: as("alpha") })).json()).toEqual({ files: [file] })
    // The same file through the OpenAI API: one id, three faces.
    const openai = (await server.send({ path: `/v1/files/file-${file.name.slice(6)}`, headers: { authorization: `Bearer ${KEYS.alpha}` } })).json()
    expect(openai).toMatchObject({ object: "file", filename: "doc.pdf" })
    expect((await server.send({ method: "DELETE", path: `/v1beta/${file.name}`, headers: as("alpha") })).json()).toEqual({})
    expect((await server.send({ path: `/v1beta/${file.name}`, headers: as("alpha") })).status).toBe(404)
  })

  test("the Python SDK's snake_case metadata names the file too", async () => {
    const { server } = await route()
    const path = target(await server.send(start("alpha", { file: { display_name: "snake.png", mime_type: "image/png", size_bytes: PNG.length } })))
    const done = await server.send(chunk("alpha", path, "upload, finalize", 0, PNG))
    expect(done.json().file).toMatchObject({ displayName: "snake.png", mimeType: "image/png" })
  })

  test("a chunked upload: `active` after each chunk, the offset must match, and the file is made on finalize", async () => {
    const { server } = await route()
    const started = await server.send(start("alpha", {}, { "x-goog-upload-header-content-type": "image/png", "x-goog-upload-file-name": "p.png" }))
    const path = target(started)
    const first = await server.send(chunk("alpha", path, "upload", 0, PNG.subarray(0, 10)))
    expect(first.headers["x-goog-upload-status"]).toBe("active")
    expect(first.headers["x-goog-upload-size-received"]).toBe("10")
    const wrong = await server.send(chunk("alpha", path, "upload", 3, PNG.subarray(10)))
    expect(wrong.status).toBe(400)
    const query = await server.send({ method: "POST", path, headers: { ...as("alpha"), "x-goog-upload-command": "query" } })
    expect(query.headers["x-goog-upload-size-received"]).toBe("10")
    const last = await server.send(chunk("alpha", path, "upload, finalize", 10, PNG.subarray(10)))
    expect(last.headers["x-goog-upload-status"]).toBe("final")
    expect(last.json().file).toMatchObject({ displayName: "p.png", mimeType: "image/png", sizeBytes: String(PNG.length) })
    // A finished upload id is gone.
    expect((await server.send(chunk("alpha", path, "upload", 0, PNG))).status).toBe(404)
  })

  test("the upload url is the credential of its chunks, as Google's is (google-genai sends them with no key): the file is the starting app's", async () => {
    const { server } = await route()
    const path = target(await server.send(start("alpha", {}, { "x-goog-upload-header-content-type": "image/png" })))
    const keyless = (init: SendInit): SendInit => ({ ...init, headers: Object.fromEntries(Object.entries(init.headers ?? {}).filter(([name]) => name !== "x-goog-api-key")) })
    // An unknown id with no key is the 401 every other route gives, and a start with no key is one too.
    expect((await server.send(keyless(chunk("alpha", `/upload/v1beta/files?upload_id=${"0".repeat(32)}`, "upload, finalize", 0, PNG)))).status).toBe(401)
    expect((await server.send(keyless(start("alpha")))).status).toBe(401)
    // A wrong key is not rescued by the id.
    const wrong = chunk("alpha", path, "upload, finalize", 0, PNG)
    expect((await server.send({ ...wrong, headers: { ...wrong.headers, "x-goog-api-key": "nope" } })).status).toBe(401)
    const done = await server.send(keyless(chunk("alpha", path, "upload, finalize", 0, PNG)))
    expect(done.status).toBe(200)
    const name = done.json().file.name
    expect((await server.send({ path: `/v1beta/${name}`, headers: as("alpha") })).status).toBe(200)
    expect((await server.send({ path: `/v1beta/${name}`, headers: as("beta") })).status).toBe(404)
  })

  test("cancel drops the upload; another app's upload id is the same 404 as an unknown one", async () => {
    const { server } = await route()
    const started = await server.send(start("alpha"))
    const path = target(started)
    const theirs = await server.send(chunk("beta", path, "upload, finalize", 0, PNG))
    const unknown = await server.send(chunk("beta", `/upload/v1beta/files?upload_id=${"0".repeat(32)}&upload_protocol=resumable`, "upload, finalize", 0, PNG))
    expect([theirs.status, unknown.status]).toEqual([404, 404])
    expect(theirs.text).toBe(unknown.text)
    // The owner's upload was not touched by it.
    const cancelled = await server.send({ method: "POST", path, headers: { ...as("alpha"), "x-goog-upload-command": "cancel" } })
    expect(cancelled.headers["x-goog-upload-status"]).toBe("cancelled")
    expect((await server.send(chunk("alpha", path, "upload, finalize", 0, PNG))).status).toBe(404)
  })

  test("a file that is not an accepted kind is refused at finalize, and an oversize upload when it starts or grows past the cap", async () => {
    const { server } = await route({ limits: { maxBodyBytes: 2048 } })
    const refused = await server.send(chunk("alpha", target(await server.send(start("alpha", {}, { "x-goog-upload-header-content-type": "image/png" }))), "upload, finalize", 0, Buffer.from("not an image")))
    expect(refused.status).toBe(400)
    expect(refused.json().error.message).toContain("PNG, JPEG, GIF and WebP")
    const tooBig = await server.send(start("alpha", {}, { "x-goog-upload-header-content-length": "999999" }))
    expect(tooBig.status).toBe(413)
    const grown = target(await server.send(start("alpha")))
    expect((await server.send(chunk("alpha", grown, "upload", 0, Buffer.alloc(1500, 1)))).status).toBe(200)
    expect((await server.send(chunk("alpha", grown, "upload, finalize", 1500, Buffer.alloc(1500, 1)))).status).toBe(413)
  })

  test("an app holds at most 4 unfinished uploads", async () => {
    const { server } = await route()
    for (let i = 0; i < 4; i++) expect((await server.send(start("alpha"))).status).toBe(200)
    const fifth = await server.send(start("alpha"))
    expect(fifth.status).toBe(429)
    expect(fifth.headers["retry-after"]).toBeDefined()
    expect((await server.send(start("beta"))).status).toBe(200)
  })

  test("a start without the start command, and uploadType=media, are 400s that say what is supported", async () => {
    const { server } = await route()
    const noStart = await server.send({ method: "POST", path: "/upload/v1beta/files", headers: { ...as("alpha"), "x-goog-upload-protocol": "resumable" }, body: {} })
    expect(noStart.status).toBe(400)
    const media = await server.send({ method: "POST", path: "/upload/v1beta/files?uploadType=media", headers: { ...as("alpha"), "content-type": "image/png" }, body: PNG })
    expect(media.status).toBe(400)
    expect(media.json().error.message).toContain("multipart")
  })
})

describe("multipart upload", () => {
  const related = (metadata: object, media: Buffer, type: string, boundary = "BOUND"): Buffer =>
    Buffer.concat([
      Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\ncontent-type: ${type}\r\n\r\n`),
      media,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
  const post = (app: App, body: Buffer, boundary = "BOUND"): SendInit => ({
    method: "POST",
    path: "/upload/v1beta/files?uploadType=multipart",
    headers: { ...as(app), "content-type": `multipart/related; boundary=${boundary}` },
    body,
  })

  test("multipart/related with JSON metadata then the file makes the file", async () => {
    const { server } = await route()
    const reply = await server.send(post("alpha", related({ file: { displayName: "p.png" } }, PNG, "image/png")))
    expect(reply.status).toBe(200)
    expect(reply.json().file).toMatchObject({ displayName: "p.png", mimeType: "image/png", sizeBytes: String(PNG.length) })
    const binary = await server.send(post("alpha", related({}, Buffer.concat([PDF, Buffer.from("\r\n--OTHER\r\n")]), "application/pdf")))
    expect(binary.status).toBe(200)
    expect(binary.json().file.sizeBytes).toBe(String(PDF.length + 11))
  })

  test("a body that is not two parts, not JSON first, or not multipart/related is a 400", async () => {
    const { server } = await route()
    expect((await server.send(post("alpha", Buffer.from("--BOUND\r\n\r\nx\r\n--BOUND--\r\n")))).status).toBe(400)
    expect((await server.send(post("alpha", related({}, PNG, "image/png").subarray(0, 40)))).status).toBe(400)
    const notJson = Buffer.from(`--BOUND\r\ncontent-type: text/plain\r\n\r\nnope\r\n--BOUND\r\ncontent-type: image/png\r\n\r\n`)
    expect((await server.send(post("alpha", Buffer.concat([notJson, PNG, Buffer.from("\r\n--BOUND--")])))).status).toBe(400)
    expect((await server.send({ method: "POST", path: "/upload/v1beta/files?uploadType=multipart", headers: { ...as("alpha"), "content-type": "application/json" }, body: {} })).status).toBe(400)
  })
})

describe("list", () => {
  test("pageSize and pageToken page the list, oldest first, and a bad size or token is a 400", async () => {
    const { server } = await route()
    const names: string[] = []
    for (let i = 0; i < 3; i++) {
      const body = Buffer.from(`--B\r\ncontent-type: application/json\r\n\r\n{"file":{"displayName":"f${i}.txt"}}\r\n--B\r\ncontent-type: text/plain\r\n\r\nbody ${i}\r\n--B--`)
      names.push((await server.send({ method: "POST", path: "/upload/v1beta/files?uploadType=multipart", headers: { ...as("alpha"), "content-type": "multipart/related; boundary=B" }, body })).json().file.name)
    }
    const first = (await server.send({ path: "/v1beta/files?pageSize=2", headers: as("alpha") })).json()
    expect(first.files.map((f: { name: string }) => f.name)).toEqual([names[0], names[1]])
    expect(first.nextPageToken).toBeString()
    const second = (await server.send({ path: `/v1beta/files?pageSize=2&pageToken=${first.nextPageToken}`, headers: as("alpha") })).json()
    expect(second.files.map((f: { name: string }) => f.name)).toEqual([names[2]])
    expect(second.nextPageToken).toBeUndefined()
    expect((await server.send({ path: "/v1beta/files?pageSize=101", headers: as("alpha") })).status).toBe(400)
    expect((await server.send({ path: "/v1beta/files?pageToken=nope", headers: as("alpha") })).status).toBe(400)
    const missing = await server.send({ path: "/v1beta/files/nope", headers: as("alpha") })
    expect(missing.status).toBe(404)
    expect(missing.json().error).toMatchObject({ code: 404, status: "NOT_FOUND" })
  })

  test("the key may be the `key` query parameter, as on the other Gemini routes", async () => {
    const { server } = await route()
    expect((await server.send({ path: `/v1beta/files?key=${KEYS.alpha}` })).status).toBe(200)
  })
})
