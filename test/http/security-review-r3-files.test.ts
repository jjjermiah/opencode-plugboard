/**
 * Security review round 3 (since 0.37.0), the Files APIs and the Gemini resumable upload: what each guarantee is and a test that
 * would fail if it stopped holding. The gaps the review found were first written as `test.failing`; each marker was removed with its
 * fix, so every test here is a guarantee that holds.
 *
 * Guarantees: another app's file or upload is never reachable (I33); an upload id is a capability for one upload and nothing else;
 * the per-app caps stop growth; a download can never be rendered by a browser; an error never carries a host path or a key.
 *
 * Unfinished uploads are process-wide state, so every test here uses app names no other test starts an upload for.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { createFileState, createFileStore, type FileStore } from "../../src/files/state.js"
import { createKeyState, createKeyStore } from "../../src/keys.js"
import type { StoragePort } from "../../src/session/host.js"
import { ev } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"
import { FakeStorage } from "../support/usage.js"

const logs = captureLogs()
const servers: RouteServer[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
})

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex")
const ANTHROPIC = { "anthropic-version": "2023-06-01" }

async function route(keys: Record<string, string>, options: Record<string, unknown> = {}, files?: FileStore, extra: Partial<Parameters<typeof startRoute>[0]> = {}) {
  const caller = new FakeModelCaller([ev.text("ok"), ev.finish()])
  const server = await startRoute({ caller, options: { keys, ...options }, ...(files ? { files } : {}), ...extra })
  servers.push(server)
  return { caller, server }
}

const bearer = (key: string) => ({ authorization: `Bearer ${key}` })
const goog = (key: string) => ({ "x-goog-api-key": key })

const begin = (key: string, headers: Record<string, string> = {}): SendInit => ({
  method: "POST",
  path: "/upload/v1beta/files",
  headers: { ...goog(key), "x-goog-upload-protocol": "resumable", "x-goog-upload-command": "start", ...headers },
  body: {},
})
const target = (reply: { headers: Record<string, string | string[] | undefined> }) => {
  const url = new URL(String(reply.headers["x-goog-upload-url"]))
  return url.pathname + url.search
}
const uploadId = (path: string) => new URL(path, "http://x").searchParams.get("upload_id")!
const piece = (path: string, command: string, offset: number, bytes: Buffer, headers: Record<string, string> = {}): SendInit => ({
  method: "POST",
  path,
  headers: { ...headers, "x-goog-upload-command": command, "x-goog-upload-offset": String(offset), "content-type": "application/octet-stream" },
  body: bytes,
})

interface Held {
  readonly app: string
  readonly keyDigest?: Buffer
  readonly chunks: Buffer[]
  readonly received: number
}
/** The process's unfinished uploads, as `src/files/gemini/route.ts` keeps them. */
const held = () => (globalThis as unknown as Record<symbol, Map<string, Held> | undefined>)[Symbol.for("opencode-plugboard.upload-sessions/1")] ?? new Map<string, Held>()

/** A `multipart/form-data` body written by hand, so the declared type and the name are exactly what the test says (a runtime's FormData may infer them). */
async function form(file: { bytes: Uint8Array; name?: string; type?: string }, fields: Record<string, string> = {}) {
  const escaped = (file.name ?? "upload.bin").replace(/\r/g, "%0D").replace(/\n/g, "%0A").replace(/"/g, "%22")
  const parts = Object.entries(fields).map(([key, value]) => Buffer.from(`--R3\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`))
  const head = `--R3\r\nContent-Disposition: form-data; name="file"; filename="${escaped}"\r\n${file.type === undefined ? "" : `Content-Type: ${file.type}\r\n`}\r\n`
  return { body: Buffer.concat([...parts, Buffer.from(head), Buffer.from(file.bytes), Buffer.from("\r\n--R3--\r\n")]), type: "multipart/form-data; boundary=R3" }
}
const upload = async (server: RouteServer, key: string, file: Parameters<typeof form>[0], headers: Record<string, string> = {}) => {
  const { body, type } = await form(file, { purpose: "user_data" })
  return server.send({ method: "POST", path: "/v1/files", headers: { ...bearer(key), ...headers, "content-type": type }, body })
}

// ---------------------------------------------------------------- the upload id is a capability for one upload

describe("security regression test: the keyless chunk path (an upload id stands for the key of the request that started it)", () => {
  test("a valid upload id with no key reaches that upload's chunks and nothing else", async () => {
    const { server } = await route({ r3chunk: "key-r3chunk", r3other: "key-r3other" })
    const path = target(await server.send(begin("key-r3chunk", { "x-goog-upload-header-content-type": "image/png" })))
    const id = uploadId(path)
    const refused: SendInit[] = [
      // Every other Files route, in every API, with the id and no key.
      { path: `/v1beta/files?upload_id=${id}` },
      { path: `/v1beta/files/${"a".repeat(32)}?upload_id=${id}` },
      { method: "DELETE", path: `/v1beta/files/${"a".repeat(32)}?upload_id=${id}` },
      { path: `/v1/files?upload_id=${id}` },
      { path: `/v1/files?upload_id=${id}`, headers: ANTHROPIC },
      { method: "POST", path: `/v1/files?upload_id=${id}`, body: PNG },
      { method: "DELETE", path: `/v1/files/file-${"a".repeat(32)}?upload_id=${id}` },
      // The model routes.
      { method: "POST", path: `/v1/chat/completions?upload_id=${id}`, body: { model: "test/echo", messages: [{ role: "user", content: "hi" }] } },
      { method: "POST", path: `/v1beta/models/test%2Fecho:generateContent?upload_id=${id}`, body: { contents: [{ parts: [{ text: "hi" }] }] } },
      // A look-alike of the id.
      piece(`/upload/v1beta/files?upload_id=${id.toUpperCase()}`, "upload", 0, PNG),
      piece(`/upload/v1beta/files?upload_id=${id}0`, "upload", 0, PNG),
      piece(`/upload/v1beta/files?upload_id=${id.slice(0, 31)}`, "upload", 0, PNG),
      piece(`/upload/v1beta/files?upload_id=${"0".repeat(32)}`, "upload", 0, PNG),
      // Another id named first decides: the id after it never rescues the request.
      piece(`/upload/v1beta/files?upload_id=${"0".repeat(32)}&upload_id=${id}`, "upload", 0, PNG),
    ]
    for (const init of refused) expect((await server.send(init)).status).toBe(401)
    // The upload itself is untouched by all of it, and the id still works for its own chunk.
    expect(held().get(id)?.received).toBe(0)
    const done = await server.send(piece(path, "upload, finalize", 0, PNG))
    expect(done.status).toBe(200)
    // The file is the starting app's, not the keyless caller's and not another app's.
    const name = done.json().file.name
    expect((await server.send({ path: `/v1beta/${name}`, headers: goog("key-r3chunk") })).status).toBe(200)
    expect((await server.send({ path: `/v1beta/${name}`, headers: goog("key-r3other") })).status).toBe(404)
  })

  test("a keyless request cannot start an upload, even with a live id in the query", async () => {
    const { server } = await route({ r3start: "key-r3start" })
    const path = target(await server.send(begin("key-r3start")))
    const mine = () => [...held().values()].filter((session) => session.app === "r3start").length
    expect(mine()).toBe(1)
    const keyless = { ...begin("key-r3start"), path, headers: { "x-goog-upload-protocol": "resumable", "x-goog-upload-command": "start" } }
    expect((await server.send(keyless)).status).toBe(400)
    expect((await server.send({ ...keyless, path: "/upload/v1beta/files" })).status).toBe(401)
    expect(mine()).toBe(1)
    await server.send(piece(path, "cancel", 0, Buffer.alloc(0), goog("key-r3start")))
  })

  test("the id is 122 random bits: v4 shaped, nothing in it counts or tells the time, and a start never repeats one", async () => {
    const { server } = await route({ r3ids: "key-r3ids" })
    const ids: string[] = []
    for (let i = 0; i < 12; i++) {
      const path = target(await server.send(begin("key-r3ids")))
      ids.push(uploadId(path))
      await server.send(piece(path, "cancel", 0, Buffer.alloc(0), goog("key-r3ids")))
    }
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$/)
    // Consecutive ids share no more than chance would (a counter or a clock would make long common prefixes).
    for (let i = 1; i < ids.length; i++) {
      let common = 0
      while (common < 32 && ids[i]![common] === ids[i - 1]![common]) common++
      expect(common).toBeLessThan(8)
    }
  })

  test("the id dies with its upload: finished, cancelled, grown past the cap, and after 10 minutes, each is a 401 with no key", async () => {
    const { server } = await route({ r3life: "key-r3life" }, { limits: { maxBodyBytes: 2048 } })
    const keyless = (path: string, command = "upload, finalize") => server.send(piece(path, command, 0, PNG))

    const finished = target(await server.send(begin("key-r3life")))
    expect((await keyless(finished)).status).toBe(200)
    expect((await keyless(finished)).status).toBe(401)

    const cancelled = target(await server.send(begin("key-r3life")))
    await server.send(piece(cancelled, "cancel", 0, Buffer.alloc(0), goog("key-r3life")))
    expect((await keyless(cancelled)).status).toBe(401)

    const grown = target(await server.send(begin("key-r3life")))
    expect((await server.send(piece(grown, "upload", 0, Buffer.alloc(1500, 1)))).status).toBe(200)
    expect((await server.send(piece(grown, "upload", 1500, Buffer.alloc(1500, 1)))).status).toBe(413)
    expect((await keyless(grown)).status).toBe(401)
    expect(held().has(uploadId(grown))).toBe(false)

    const old = target(await server.send(begin("key-r3life")))
    const real = Date.now
    const clock = spyOn(Date, "now").mockImplementation(() => real() + 10 * 60 * 1000 + 1)
    try {
      expect((await keyless(old)).status).toBe(401)
      // With the key it is the same miss as an unknown id, and the upload is released.
      expect((await server.send(piece(old, "upload, finalize", 0, PNG, goog("key-r3life")))).status).toBe(404)
    } finally {
      clock.mockRestore()
    }
    expect(held().has(uploadId(old))).toBe(false)
  })

  test("an expired upload is released by the next upload anyone starts, and its bytes with it", async () => {
    const { server } = await route({ r3old: "key-r3old", r3new: "key-r3new" })
    const old = target(await server.send(begin("key-r3old")))
    await server.send(piece(old, "upload", 0, Buffer.alloc(1000, 1), goog("key-r3old")))
    expect(held().get(uploadId(old))?.received).toBe(1000)
    const real = Date.now
    const clock = spyOn(Date, "now").mockImplementation(() => real() + 10 * 60 * 1000 + 1)
    try {
      await server.send(begin("key-r3new"))
    } finally {
      clock.mockRestore()
    }
    expect(held().has(uploadId(old))).toBe(false)
  })

  test("a revoked key ends its uploads: the id no longer finishes one, and another key of the app does not either", async () => {
    const keys = createKeyStore({ state: createKeyState(), storage: new FakeStorage() })
    const { server } = await route({ r3admin: "key-r3admin" }, { adminKey: "admin-r3-secret" }, undefined, { keys })
    const mint = async () => (await server.send({ method: "POST", path: "/plugboard/admin/keys", headers: bearer("admin-r3-secret"), body: { app: "r3runtime" } })).json()
    const old = await mint()
    const fresh = await mint()
    const path = target(await server.send(begin(old.key)))
    const second = target(await server.send(begin(fresh.key)))
    expect(held().get(uploadId(path))?.app).toBe("r3runtime")
    expect((await server.send({ method: "DELETE", path: `/plugboard/admin/keys/${old.id}`, headers: bearer("admin-r3-secret") })).status).toBe(200)
    expect((await server.send({ path: "/v1beta/files", headers: goog(old.key) })).status).toBe(401)
    expect((await server.send(piece(path, "upload, finalize", 0, PNG))).status).toBe(401)
    expect(held().has(uploadId(path))).toBe(false)
    // The key that started the other upload is live, so that upload still finishes, with its key or without one.
    expect((await server.send(piece(second, "upload, finalize", 0, PNG))).status).toBe(200)
    // An upload of a key that is revoked is gone for the app's other keys too.
    const dropped = target(await server.send(begin(fresh.key)))
    await server.send({ method: "DELETE", path: `/plugboard/admin/keys/${fresh.id}`, headers: bearer("admin-r3-secret") })
    const replacement = await mint()
    expect((await server.send(piece(dropped, "upload, finalize", 0, PNG, goog(replacement.key)))).status).toBe(404)
    expect(held().has(uploadId(dropped))).toBe(false)
  })

  test("a keyless server's uploads need no key to stay good, whatever token a start carried", async () => {
    const { server } = await route({}, {})
    const started = await server.send({
      method: "POST",
      path: "/upload/v1beta/files",
      headers: { "x-goog-api-key": "any-token", "x-goog-upload-protocol": "resumable", "x-goog-upload-command": "start" },
      body: {},
    })
    expect(started.status).toBe(200)
    expect(held().get(uploadId(target(started)))?.keyDigest).toBeUndefined()
    expect((await server.send(piece(target(started), "upload, finalize", 0, PNG))).status).toBe(200)
  })

  test("a chunk with no bytes adds nothing to what the upload holds, and the offset still moves by what was sent", async () => {
    const { server } = await route({ r3empty: "key-r3empty" })
    const path = target(await server.send(begin("key-r3empty")))
    for (let i = 0; i < 25; i++) expect((await server.send(piece(path, "upload", 0, Buffer.alloc(0), goog("key-r3empty")))).status).toBe(200)
    expect(held().get(uploadId(path))?.chunks.length ?? 0).toBe(0)
    expect((await server.send(piece(path, "upload", 0, PNG.subarray(0, 10), goog("key-r3empty")))).headers["x-goog-upload-size-received"]).toBe("10")
    const done = await server.send(piece(path, "upload, finalize", 10, PNG.subarray(10), goog("key-r3empty")))
    expect(done.status).toBe(200)
    expect(done.json().file.sizeBytes).toBe(String(PNG.length))
  })

  test("one timer drops the uploads that have expired when nothing else touches them, and stops when none are held", async () => {
    const slot = Symbol.for("opencode-plugboard.upload-sweep/1")
    const holder = globalThis as unknown as Record<symbol, unknown>
    if (holder[slot] !== undefined) clearInterval(holder[slot] as ReturnType<typeof setInterval>)
    holder[slot] = undefined
    held().clear()
    const ticks: Array<() => void> = []
    const intervals: unknown[] = []
    const set = spyOn(globalThis, "setInterval").mockImplementation(((tick: () => void, ms: number) => {
      // Only the sweep's own timer: nothing else here is a minute long.
      if (ms === 60_000) {
        ticks.push(tick)
        intervals.push(ms)
      }
      return { unref() {} }
    }) as never)
    const clear = spyOn(globalThis, "clearInterval").mockImplementation((() => {}) as never)
    const real = Date.now
    try {
      const { server } = await route({ r3timer: "key-r3timer" })
      const first = target(await server.send(begin("key-r3timer")))
      const second = target(await server.send(begin("key-r3timer")))
      // One timer for both, a minute apart.
      expect(ticks).toHaveLength(1)
      expect(intervals).toEqual([60_000])
      expect(held().has(uploadId(first)) && held().has(uploadId(second))).toBe(true)
      ticks[0]!()
      expect(held().size).toBe(2)
      expect(clear).not.toHaveBeenCalled()
      const clock = spyOn(Date, "now").mockImplementation(() => real() + 10 * 60 * 1000 + 1)
      try {
        ticks[0]!()
      } finally {
        clock.mockRestore()
      }
      expect(held().size).toBe(0)
      expect(clear).toHaveBeenCalledTimes(1)
      expect(holder[slot]).toBeUndefined()
    } finally {
      set.mockRestore()
      clear.mockRestore()
      holder[slot] = undefined
    }
  })

  test("any request to the upload route drops the uploads that have expired, not only the start of a new one", async () => {
    const { server } = await route({ r3sweep: "key-r3sweep", r3sweep2: "key-r3sweep2" })
    const old = target(await server.send(begin("key-r3sweep")))
    await server.send(piece(old, "upload", 0, Buffer.alloc(1000, 1), goog("key-r3sweep")))
    const other = target(await server.send(begin("key-r3sweep2")))
    expect(held().has(uploadId(old))).toBe(true)
    const real = Date.now
    const clock = spyOn(Date, "now").mockImplementation(() => real() + 10 * 60 * 1000 + 1)
    try {
      // A query on another app's upload, which is itself expired here: the sweep drops both.
      await server.send(piece(other, "query", 0, Buffer.alloc(0), goog("key-r3sweep2")))
    } finally {
      clock.mockRestore()
    }
    expect(held().has(uploadId(old))).toBe(false)
    expect(held().has(uploadId(other))).toBe(false)
  })
})

// ---------------------------------------------------------------- caps

describe("security regression test: per-app caps stop growth", () => {
  const TEXT = (name: string) => Buffer.from(`file ${name}`)

  test("an app past its file count, its byte budget, or its unfinished-upload count is refused, whichever API uploads", async () => {
    const files = createFileStore({ storage: new FakeStorage(), state: createFileState(), limits: { maxFiles: 2, maxAppBytes: 40 } })
    const { server } = await route({ r3cap: "key-r3cap", r3cap2: "key-r3cap2" }, {}, files)
    const text = (key: string, name: string, bytes = TEXT(name)) => upload(server, key, { bytes, name, type: "text/plain" })
    expect((await text("key-r3cap", "a.txt")).status).toBe(200)
    // The Gemini multipart route and the Anthropic-style route count against the same budget as the OpenAI one.
    const related = Buffer.concat([
      Buffer.from('--B\r\nContent-Type: application/json\r\n\r\n{"file":{"displayName":"b.txt"}}\r\n--B\r\nContent-Type: text/plain\r\n\r\n'),
      TEXT("b.txt"),
      Buffer.from("\r\n--B--\r\n"),
    ])
    const viaGemini = await server.send({
      method: "POST",
      path: "/upload/v1beta/files?uploadType=multipart",
      headers: { ...goog("key-r3cap"), "content-type": "multipart/related; boundary=B" },
      body: related,
    })
    expect(viaGemini.status).toBe(200)
    const third = await text("key-r3cap", "c.txt")
    expect(third.status).toBe(400)
    expect(third.json().error.code).toBe("file_limit_exceeded")
    const viaAnthropic = await upload(server, "key-r3cap", { bytes: TEXT("d"), name: "d.txt", type: "text/plain" }, ANTHROPIC)
    expect(viaAnthropic.status).toBe(400)
    // The budget is the app's, not the server's.
    expect((await text("key-r3cap2", "e.txt")).status).toBe(200)
    // Deleting frees room; the byte budget is the other cap.
    const listed = (await server.send({ path: "/v1/files", headers: bearer("key-r3cap") })).json().data
    await server.send({ method: "DELETE", path: `/v1/files/${listed[0].id}`, headers: bearer("key-r3cap") })
    const heavy = await text("key-r3cap", "h.txt", Buffer.alloc(60, 0x61))
    expect(heavy.json().error.code).toBe("file_storage_full")
  })

  test("a body over the app's cap is refused before it is read, and a declared length alone never buffers it", async () => {
    const { server } = await route({ r3body: "key-r3body" }, { limits: { maxBodyBytes: 4096 } })
    const declared = await server.send({
      method: "POST",
      path: "/v1/files",
      headers: { ...bearer("key-r3body"), "content-type": "multipart/form-data; boundary=x", "content-length": String(8 * 1024 * 1024) },
    })
    expect(declared.status).toBe(413)
    const inline = await upload(server, "key-r3body", { bytes: Buffer.alloc(8192, 1), name: "big.bin" })
    expect(inline.status).toBe(413)
  })

  test("a burst of uploads never leaves an app with more files than its count cap", async () => {
    const files = createFileStore({ storage: new FakeStorage(), state: createFileState(), limits: { maxFiles: 3 } })
    const saved = await Promise.all(Array.from({ length: 12 }, (_, i) => files.save("burst", 30, { filename: `f${i}.txt`, mime: "text/plain", purpose: "user_data", bytes: Buffer.from(`file ${i}`) })))
    expect(saved.filter((result) => "id" in result)).toHaveLength(3)
    expect(saved.filter((result) => "code" in result).every((result) => (result as { code: string }).code === "file_limit_exceeded")).toBe(true)
    expect(await files.ids("burst", 30)).toHaveLength(3)
  })

  test("a burst of uploads never leaves an app past its byte cap", async () => {
    const files = createFileStore({ storage: new FakeStorage(), state: createFileState(), limits: { maxAppBytes: 100 } })
    await Promise.all(Array.from({ length: 12 }, (_, i) => files.save("burst", 30, { filename: `f${i}.txt`, mime: "text/plain", purpose: "user_data", bytes: Buffer.alloc(40, 0x61) })))
    const sizes = await Promise.all((await files.ids("burst", 30)).map((id) => files.head("burst", id, 30)))
    expect(sizes.reduce((sum, record) => sum + (record?.bytes ?? 0), 0)).toBeLessThanOrEqual(100)
    expect(sizes).toHaveLength(2)
  })

  test("a burst over HTTP is held to the cap too, and another app's burst does not wait for it", async () => {
    const files = createFileStore({ storage: new FakeStorage(), state: createFileState(), limits: { maxFiles: 2 } })
    const { server } = await route({ r3burst: "key-r3burst", r3burst2: "key-r3burst2" }, {}, files)
    const send = (key: string, i: number) => upload(server, key, { bytes: Buffer.from(`file ${i}`), name: `f${i}.txt`, type: "text/plain" })
    const replies = await Promise.all([...Array.from({ length: 8 }, (_, i) => send("key-r3burst", i)), send("key-r3burst2", 0)])
    expect(replies.slice(0, 8).filter((reply) => reply.status === 200)).toHaveLength(2)
    expect(replies[8]!.status).toBe(200)
    expect((await server.send({ path: "/v1/files", headers: bearer("key-r3burst") })).json().data).toHaveLength(2)
  })

  test("a failed save does not hold up the app's next one", async () => {
    const storage = new FakeStorage()
    const files = createFileStore({ storage, state: createFileState() })
    storage.failPuts = true
    await expect(files.save("queue", 30, { filename: "a.txt", mime: "text/plain", purpose: "user_data", bytes: Buffer.from("a") })).rejects.toThrow()
    storage.failPuts = false
    expect(await files.save("queue", 30, { filename: "b.txt", mime: "text/plain", purpose: "user_data", bytes: Buffer.from("b") })).toHaveProperty("id")
  })

  test("the files a request names are checked by their sizes before any is read: too many large ones are a 400 and no file's bytes are read", async () => {
    const real = createFileStore({ storage: new FakeStorage(), state: createFileState() })
    let reads = 0
    const MIB = 1024 * 1024
    const claimed = new Map<string, number>()
    // The store reports sizes as if each file were large; the point is that the sizes decide before `read` is called.
    const files: FileStore = {
      ...real,
      head: async (app, id, days) => {
        const record = await real.head(app, id, days)
        return record === undefined ? undefined : { ...record, bytes: claimed.get(id) ?? record.bytes }
      },
      read: (app, id, days) => {
        reads++
        return real.read(app, id, days)
      },
    }
    const { server, caller } = await route({ r3size: "key-r3size" }, {}, files)
    const images = await Promise.all([1, 2, 3].map(() => upload(server, "key-r3size", { bytes: PNG, name: "p.png" })))
    for (const reply of images) claimed.set(reply.json().id, 20 * MIB)
    const chat = (ids: string[]) => ({
      method: "POST",
      path: "/v1/chat/completions",
      headers: bearer("key-r3size"),
      body: { model: "test/echo", messages: [{ role: "user", content: ids.map((id) => ({ type: "file", file: { file_id: id } })) }] },
    })
    // Two of them are 40 MiB of image (about 53 MiB as data URLs), three are more: over the media limit before any read.
    const over = await server.send(chat(images.map((reply) => reply.json().id)))
    expect(over.status).toBe(400)
    expect(over.json().error).toMatchObject({ code: "files_too_large" })
    expect(reads).toBe(0)
    expect(caller.calls).toEqual([])
    // One is within the limit and is read and used as before.
    expect((await server.send(chat([images[0]!.json().id]))).status).toBe(200)
    expect(reads).toBe(1)
    // The same for Responses.
    const responses = await server.send({
      method: "POST",
      path: "/v1/responses",
      headers: bearer("key-r3size"),
      body: { model: "test/echo", input: [{ role: "user", content: images.map((reply) => ({ type: "input_image", file_id: reply.json().id })) }] },
    })
    expect(responses.status).toBe(400)
    expect(responses.json().error.code).toBe("files_too_large")
    expect(reads).toBe(1)
  })
})

describe("security regression test: the type a text upload declares", () => {
  test("a text type declared in the part's own headers is the declared type, whatever the runtime's parser made of the file name", async () => {
    const { server } = await route({ r3decl: "key-r3decl" })
    const send = (name: string, type: string, bytes: Buffer) => upload(server, "key-r3decl", { bytes, name, type })
    const notes = await send("notes.bin", "text/plain", Buffer.from("plain words"))
    expect(notes.status, notes.text).toBe(200)
    expect((await server.send({ path: `/v1/files/${notes.json().id}/content`, headers: bearer("key-r3decl") })).headers["content-type"]).toBe("text/plain; charset=utf-8")
    const data = await send("data.dat", "application/json", Buffer.from('{"a":1}'))
    expect(data.status, data.text).toBe(200)
    // The bytes still decide: a declared text type never makes binary text, an image or a PDF anything but what it is.
    expect((await send("binary.txt", "text/plain", Buffer.from([0xff, 0xfe, 0x00]))).status).toBe(400)
    const png = await send("p.txt", "text/plain", PNG)
    expect(png.status).toBe(200)
    expect((await server.send({ path: `/v1/files/${png.json().id}/content`, headers: bearer("key-r3decl") })).headers["content-type"]).toBe("image/png")
    // A declared image type for text is still refused, and so is a declared type that is no type.
    expect((await send("t.txt", "image/png", Buffer.from("words"))).status).toBe(400)
    expect((await send("t.bin", "nonsense", Buffer.from("words"))).status).toBe(400)
  })

  test("the first file part decides, and a field or a later part cannot change it", async () => {
    const { server } = await route({ r3decl2: "key-r3decl2" })
    const body = Buffer.from(
      '--R3\r\nContent-Disposition: form-data; name="purpose"\r\nContent-Type: text/html\r\n\r\nuser_data\r\n' +
        '--R3\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\nContent-Type: text/plain\r\n\r\nfirst\r\n' +
        '--R3\r\nContent-Disposition: form-data; name="file"; filename="b.bin"\r\nContent-Type: image/png\r\n\r\nsecond\r\n--R3--\r\n',
    )
    const made = await server.send({ method: "POST", path: "/v1/files", headers: { ...bearer("key-r3decl2"), "content-type": "multipart/form-data; boundary=R3" }, body })
    expect(made.status, made.text).toBe(200)
    expect(made.json().filename).toBe("a.bin")
    const content = await server.send({ path: `/v1/files/${made.json().id}/content`, headers: bearer("key-r3decl2") })
    expect(content.text).toBe("first")
    expect(content.headers["content-type"]).toBe("text/plain; charset=utf-8")
  })
})

// ---------------------------------------------------------------- isolation

describe("security regression test: another app's file is a miss (I33)", () => {
  test("an app whose name is a prefix of another's sees none of its files, its count or its upload", async () => {
    const { server } = await route({ r3a: "key-r3a", "r3a-2": "key-r3a-2" })
    const mine = (await upload(server, "key-r3a", { bytes: PNG, name: "mine.png" })).json()
    const theirs = (await upload(server, "key-r3a-2", { bytes: PNG, name: "theirs.png" })).json()
    expect((await server.send({ path: "/v1/files", headers: bearer("key-r3a") })).json().data.map((file: { id: string }) => file.id)).toEqual([mine.id])
    expect((await server.send({ path: "/v1/files", headers: bearer("key-r3a-2") })).json().data.map((file: { id: string }) => file.id)).toEqual([theirs.id])
    expect((await server.send({ path: `/v1/files/${theirs.id}/content`, headers: bearer("key-r3a") })).status).toBe(404)
    expect((await server.send({ path: `/v1/files/${mine.id}/content`, headers: bearer("key-r3a-2") })).status).toBe(404)
    // An upload started by one is not finished by the other, with a key or without.
    const path = target(await server.send(begin("key-r3a")))
    expect((await server.send(piece(path, "upload, finalize", 0, PNG, goog("key-r3a-2")))).status).toBe(404)
    expect(held().get(uploadId(path))?.app).toBe("r3a")
    await server.send(piece(path, "cancel", 0, Buffer.alloc(0), goog("key-r3a")))
  })

  test("a Gemini fileUri names the caller's own file whatever host it carries: another app's id is a 404, never a fetch", async () => {
    const { server, caller } = await route({ r3uri: "key-r3uri", r3uri2: "key-r3uri2" })
    const mine = (await upload(server, "key-r3uri", { bytes: PNG, name: "mine.png" })).json()
    const hex = mine.id.slice(5)
    for (const uri of [`files/${hex}`, `https://evil.example/v1beta/files/${hex}`, `http://127.0.0.1:1/v1/files/file-${hex}`]) {
      const reply = await server.send({
        method: "POST",
        path: "/v1beta/models/test%2Fecho:generateContent",
        headers: goog("key-r3uri2"),
        body: { contents: [{ parts: [{ fileData: { fileUri: uri } }] }] },
      })
      expect(reply.status).toBe(404)
    }
    expect(caller.calls).toEqual([])
  })

  test("a stored response that names a file is another app's miss on every route, and the file's bytes are never in it", async () => {
    const { server, caller } = await route({ r3resp: "key-r3resp", r3resp2: "key-r3resp2" })
    const text = (await upload(server, "key-r3resp", { bytes: Buffer.from("PRIVATE WORDS in a file"), name: "n.txt", type: "text/plain" })).json()
    const image = (await upload(server, "key-r3resp", { bytes: PNG, name: "p.png" })).json()
    const reply = await server.send({
      method: "POST",
      path: "/v1/responses",
      headers: bearer("key-r3resp"),
      body: {
        model: "test/echo",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: "see" },
              { type: "input_file", file_id: text.id },
              { type: "input_image", file_id: image.id },
            ],
          },
        ],
      },
    })
    expect(reply.status).toBe(200)
    expect(caller.calls[0]!.request.messages[0]!.content.some((part) => part.type === "text" && part.text.includes("PRIVATE WORDS"))).toBe(true)
    const id = reply.json().id
    // The record keeps references, so nothing about the file is in what another reader of the record could see.
    const items = await server.send({ path: `/v1/responses/${id}/input_items?order=asc`, headers: bearer("key-r3resp") })
    expect(items.text).not.toContain("PRIVATE WORDS")
    expect(items.text).not.toContain(Buffer.from(PNG).toString("base64"))
    expect(items.json().data[0].content).toEqual([
      { type: "input_text", text: "see" },
      { type: "input_file", file_id: text.id },
      { type: "input_image", file_id: image.id },
    ])
    for (const init of [{ path: `/v1/responses/${id}` }, { path: `/v1/responses/${id}/input_items` }, { method: "DELETE", path: `/v1/responses/${id}` }] as SendInit[])
      expect((await server.send({ ...init, headers: bearer("key-r3resp2") })).status).toBe(404)
    const chained = await server.send({ method: "POST", path: "/v1/responses", headers: bearer("key-r3resp2"), body: { model: "test/echo", input: "again", previous_response_id: id } })
    expect(chained.status).toBe(400)
    expect(caller.calls).toHaveLength(1)
    // A file deleted afterwards ends the chain with a 404 for the owner too: the bytes are not kept in the record.
    await server.send({ method: "DELETE", path: `/v1/files/${text.id}`, headers: bearer("key-r3resp") })
    const owner = await server.send({ method: "POST", path: "/v1/responses", headers: bearer("key-r3resp"), body: { model: "test/echo", input: "again", previous_response_id: id } })
    expect(owner.status).toBe(404)
  })

  test("another app's output item is not an item_reference this app can use", async () => {
    const caller = new FakeModelCaller([ev.text("secret answer"), ev.finish()])
    const server = await startRoute({ caller, options: { keys: { r3item: "key-r3item", r3item2: "key-r3item2" } } })
    servers.push(server)
    const first = (await server.send({ method: "POST", path: "/v1/responses", headers: bearer("key-r3item"), body: { model: "test/echo", input: "hi" } })).json()
    const itemId = first.output[0].id
    const owner = await server.send({
      method: "POST",
      path: "/v1/responses",
      headers: bearer("key-r3item"),
      body: {
        model: "test/echo",
        input: [
          { type: "item_reference", id: itemId },
          { role: "user", content: "and?" },
        ],
      },
    })
    expect(owner.status).toBe(200)
    const calls = caller.calls.length
    const other = await server.send({
      method: "POST",
      path: "/v1/responses",
      headers: bearer("key-r3item2"),
      body: {
        model: "test/echo",
        input: [
          { type: "item_reference", id: itemId },
          { role: "user", content: "and?" },
        ],
      },
    })
    expect(other.status).toBe(400)
    expect(other.text).not.toContain("secret answer")
    expect(caller.calls).toHaveLength(calls)
  })
})

// ---------------------------------------------------------------- what a download can do in a browser

describe("security regression test: a download is never rendered", () => {
  const rendering = (reply: { headers: Record<string, string | string[] | undefined> }) => {
    expect(reply.headers["x-content-type-options"]).toBe("nosniff")
    expect(String(reply.headers["content-security-policy"])).toContain("default-src 'none'")
    expect(String(reply.headers["content-security-policy"])).toContain("sandbox")
    expect(String(reply.headers["content-disposition"])).toMatch(/^attachment;/)
    expect(reply.headers["cache-control"]).toBe("private, no-store")
  }

  // The runtime's multipart parser (Bun) derives a part's type from its file name, so a declared type may or may not reach the
  // server as sent. These cases hold either way: the file is refused, or it is stored as text and never as an image or markup type
  // a browser would render, and a download carries the same headers whatever it is.
  test("markup the caller calls text, or names with a text extension, is refused or kept as text, with the same headers in both API styles", async () => {
    const { server } = await route({ r3dl: "key-r3dl" })
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    const html = Buffer.from("<script>alert(1)</script>")
    const cases: Array<[string, { bytes: Buffer; name: string; type?: string }, "refused" | "text/plain" | "text/html" | "either"]> = [
      ["svg declared as an image", { bytes: svg, name: "x.svg", type: "image/svg+xml" }, "refused"],
      ["svg with no type and an svg extension", { bytes: svg, name: "x.svg" }, "refused"],
      ["svg named as text", { bytes: svg, name: "x.txt", type: "text/plain" }, "text/plain"],
      ["svg declared as text under an svg name", { bytes: svg, name: "x.svg", type: "text/plain" }, "either"],
      ["html with no type and an html extension", { bytes: html, name: "x.html" }, "text/html"],
      ["html declared as html under an image name", { bytes: html, name: "x.png", type: "text/html" }, "either"],
      ["html declared as an image", { bytes: html, name: "x.html", type: "image/png" }, "either"],
    ]
    for (const [label, file, expected] of cases) {
      const made = await upload(server, "key-r3dl", file)
      if (expected === "refused" || (expected === "either" && made.status === 400)) {
        expect(made.status, label).toBe(400)
        continue
      }
      expect(made.status, `${label}: ${made.text}`).toBe(200)
      for (const headers of [{}, ANTHROPIC]) {
        const download = await server.send({ path: `/v1/files/${made.json().id}/content`, headers: { ...bearer("key-r3dl"), ...headers } })
        expect(download.status).toBe(200)
        const type = String(download.headers["content-type"])
        if (expected === "either") expect(type).not.toMatch(/^image\/svg/)
        else expect(type).toBe(`${expected}; charset=utf-8`)
        expect(download.text).toBe(file.bytes.toString())
        rendering(download)
      }
    }
  })

  test("a polyglot is the type its first bytes show, and still never rendered as anything else", async () => {
    const { server } = await route({ r3poly: "key-r3poly" })
    const made = (await upload(server, "key-r3poly", { bytes: Buffer.concat([PNG, Buffer.from("<script>alert(1)</script>")]), name: "x.html", type: "text/html" })).json()
    const download = await server.send({ path: `/v1/files/${made.id}/content`, headers: bearer("key-r3poly") })
    expect(download.headers["content-type"]).toBe("image/png")
    rendering(download)
  })

  test("a hostile file name is one printable-ASCII header value, with the exact name only percent-encoded", async () => {
    const { server } = await route({ r3name: "key-r3name" })
    for (const name of [
      'a"b.txt',
      "a\\b.txt",
      "a;b=c.txt",
      "a%0d%0ab.txt",
      "\u202etxt.exe.txt",
      "caf\u00e9 \u{1f600}.txt",
      `${"x".repeat(300)}.txt`,
      "..\\..\\etc\\passwd.txt",
      "a\r\nx-injected: 1.txt",
      "a\u0001b\u007f.txt",
    ]) {
      const made = await upload(server, "key-r3name", { bytes: Buffer.from("hello"), name, type: "text/plain" })
      expect(made.status).toBe(200)
      const download = await server.send({ path: `/v1/files/${made.json().id}/content`, headers: bearer("key-r3name") })
      const disposition = String(download.headers["content-disposition"])
      expect(disposition).toMatch(/^attachment; filename="[\x20-\x7e]*"; filename\*=UTF-8''[A-Za-z0-9%._~!$&+=@:-]*$/)
      expect(disposition.match(/filename=/g)).toHaveLength(1)
      expect(download.headers["x-injected"]).toBeUndefined()
      // What the file is called never leaves a directory part or a control character.
      expect(made.json().filename.length).toBeLessThanOrEqual(255)
      expect(made.json().filename).not.toMatch(/[\\/\u0000-\u001f]/)
    }
  })
})

// ---------------------------------------------------------------- error text

describe("security regression test: an error names no host path, no key and no provider text", () => {
  const SECRET_PATH = "/var/lib/opencode/secret-store/plugboard.sqlite"
  const SECRET_KEY = "sk-live-do-not-leak-0123456789"

  /** A store whose every call fails the way a locked or full host database does, with the text such a failure carries. */
  const broken = (): StoragePort => {
    const fail = async (): Promise<never> => {
      throw new Error(`SQLITE_FULL: database or disk is full: ${SECRET_PATH}`)
    }
    return { get: fail, put: fail, drop: fail, scan: fail }
  }

  test("a storage failure answers the same generic message on every Files route and every API, and the answers carry neither the path nor the key", async () => {
    const storage = new FakeStorage()
    const files = createFileStore({ storage, state: createFileState() })
    const { server } = await route({ r3err: SECRET_KEY }, {}, files)
    const mine = (await upload(server, SECRET_KEY, { bytes: PNG, name: "p.png" })).json()
    const swap = createFileStore({ storage: broken(), state: createFileState() })
    Object.assign(files, swap)
    const hex = mine.id.slice(5)
    const start = await server.send(begin(SECRET_KEY))
    const path = target(start)
    const inits: SendInit[] = [
      { path: "/v1/files", headers: bearer(SECRET_KEY) },
      { path: `/v1/files/${mine.id}`, headers: bearer(SECRET_KEY) },
      { path: `/v1/files/${mine.id}/content`, headers: bearer(SECRET_KEY) },
      { method: "DELETE", path: `/v1/files/${mine.id}`, headers: bearer(SECRET_KEY) },
      { path: "/v1/files", headers: { ...bearer(SECRET_KEY), ...ANTHROPIC } },
      { path: `/v1/files/${mine.id}`, headers: { "x-api-key": SECRET_KEY, ...ANTHROPIC } },
      { path: "/v1beta/files", headers: goog(SECRET_KEY) },
      { path: `/v1beta/files/${hex}?key=${SECRET_KEY}` },
      { method: "DELETE", path: `/v1beta/files/${hex}`, headers: goog(SECRET_KEY) },
      piece(path, "upload, finalize", 0, PNG, goog(SECRET_KEY)),
      {
        method: "POST",
        path: "/v1/chat/completions",
        headers: bearer(SECRET_KEY),
        body: { model: "test/echo", messages: [{ role: "user", content: [{ type: "file", file: { file_id: mine.id } }] }] },
      },
      { method: "POST", path: "/v1beta/models/test%2Fecho:generateContent", headers: goog(SECRET_KEY), body: { contents: [{ parts: [{ fileData: { fileUri: `files/${hex}` } }] }] } },
    ]
    const upl = await form({ bytes: PNG, name: "p.png" }, { purpose: "user_data" })
    inits.push({ method: "POST", path: "/v1/files", headers: { ...bearer(SECRET_KEY), "content-type": upl.type }, body: upl.body })
    for (const init of inits) {
      const reply = await server.send(init)
      expect(reply.status).toBe(500)
      expect(reply.text).not.toContain("/var/lib")
      expect(reply.text).not.toContain("sqlite")
      expect(reply.text).not.toContain("SQLITE")
      expect(reply.text).not.toContain(SECRET_KEY)
      expect(reply.text).not.toContain(mine.id)
      expect(JSON.stringify(reply.headers)).not.toContain(SECRET_KEY)
    }
    // The operator's log keeps the cause, and never a key or a file id.
    const text = logs.lines.map((line) => line.raw).join("\n")
    expect(text).not.toContain(SECRET_KEY)
    expect(text).not.toContain(mine.id)
  })

  test("a refused upload says what is wrong with the file and nothing about the host", async () => {
    const { server } = await route({ r3msg: SECRET_KEY })
    const refusals = [
      await upload(server, SECRET_KEY, { bytes: Buffer.from("MZ\u0090\u0000\u0003"), name: "evil.exe", type: "application/x-msdownload" }),
      await upload(server, SECRET_KEY, { bytes: Buffer.alloc(0), name: "empty.txt", type: "text/plain" }),
      await upload(server, SECRET_KEY, { bytes: Buffer.from([0xff, 0xfe, 0xfd]), name: "bin.txt", type: "text/plain" }),
      await server.send({ method: "POST", path: "/v1/files", headers: { ...bearer(SECRET_KEY), "content-type": "multipart/form-data; boundary=zzz" }, body: "garbage" }),
    ]
    for (const reply of refusals) {
      expect(reply.status).toBe(400)
      expect(reply.text).not.toMatch(/\/(?:Users|home|var|tmp|private)\//)
      expect(reply.text).not.toContain(SECRET_KEY)
    }
  })
})
