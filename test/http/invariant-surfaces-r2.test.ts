/**
 * #408 red-team round 2 (role `surfaces`): HTTP-layer checks for the four configuration areas
 * where the behaviour depends on the HTTP route, request decoders, or response headers:
 *   1. `opencodeTools` on the wire: `x-plugboard-opencode-tools` counts from the real session caller,
 *      `app_dir_outside_root` when the app directory is a symlink outside the data root, and #421
 *      (`tool_choice: "none"` without caller `tools` dropped by the request decoders).
 *   2. `remoteImages` on the wire: octal/shorthand IPv4 refusals, redirect re-checks, wrong content
 *      type and declared/streamed oversize refusals return 400 with the error code and create no session.
 *   3. No-keys mode on the wire: foreign `Host` (including behind `trustProxy`) and `Origin`
 *      refusals across routes return 403 with the route's error code and never call the model.
 *   4. Response `cache` on the wire: per-app `reasoningOutput` on misses and hits, `reasoning_effort`
 *      and `tools` cache keys, and end-user isolation across apps vs sharing within one app (#278).
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import type { ServerResponse } from "node:http"
import { join } from "node:path"
import { Effect } from "effect"
import type { PlugboardOptions } from "../../src/config.js"
import { withResponseCache } from "../../src/runtime.js"
import { createSessionCaller } from "../../src/session/caller.js"
import { installSessionHooks } from "../../src/session/context.js"
import type { ContextHookEvent, HostToolDescriptor } from "../../src/session/host.js"
import type { OperatorRule } from "../../src/session/seeds.js"
import { createSessionStore } from "../../src/session/state.js"
import { ev, testOptions } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { listen, startRoute, type Loopback, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller, type Script } from "../support/model-caller.js"
import { spyContext } from "../support/plugin-context.js"
import { isolateRuntime } from "../support/runtime.js"
import { bus, FakeSessionPort } from "../support/session.js"

captureLogs()
isolateRuntime()

let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex")

const seeds = (count = 4): Record<string, HostToolDescriptor> => Object.fromEntries(Array.from({ length: count }, (_, index) => [`plugboard_seed_${index}`, { description: "placeholder", input: {} }]))

const hostTools = (): Record<string, HostToolDescriptor> => ({
  ...seeds(4),
  read: { description: "Read file", input: { type: "object" } },
  glob: { description: "Glob files", input: { type: "object" } },
  grep: { description: "Grep files", input: { type: "object" } },
})

// ---------------------------------------------------------------- 1. opencodeTools on the wire

describe("#408 1. opencodeTools on the wire", () => {
  const OPERATOR_RULES: OperatorRule[] = [
    { action: "*", resource: "*", effect: "deny" },
    { action: "read", resource: "*", effect: "allow" },
    { action: "glob", resource: "*", effect: "allow" },
    { action: "grep", resource: "*", effect: "allow" },
  ]

  const APPS: PlugboardOptions["apps"] = {
    trusted: {
      systemMode: "prepend",
      tools: true,
      opencodeTools: ["read", "glob", "grep"],
      maxToolSteps: 2,
      maxToolCalls: 3,
    },
    plain: {
      systemMode: "prepend",
      tools: true,
    },
  }

  const OPTIONS = {
    models: ["test/*"],
    maxChoices: 2,
    keys: { trusted: "k-trusted", plain: "k-plain" },
    apps: {
      trusted: { opencodeTools: ["read", "glob", "grep"], maxToolSteps: 2, maxToolCalls: 3 },
      plain: {},
    },
  }

  const TRUSTED = { authorization: "Bearer k-trusted" }
  const PLAIN = { authorization: "Bearer k-plain" }

  test("a symlinked app directory pointing outside the data root is refused with 500 app_dir_outside_root before any session is created", async () => {
    const root = join(process.env.XDG_DATA_HOME!, "opencode-plugboard")
    const outside = join(process.env.XDG_DATA_HOME!, "outside-scratch")
    mkdirSync(root, { recursive: true })
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, "secret.txt"), "OUTSIDE")
    symlinkSync(outside, join(root, "trusted"))

    try {
      const port = new FakeSessionPort()
      port.toolIDs.push("read", "glob", "grep")
      const sessions = createSessionStore()
      const caller = createSessionCaller({ port, sessions, maxTools: 4, apps: APPS })
      server = await startRoute({ caller, options: OPTIONS })
      const reply = await server.send({
        method: "POST",
        path: "/v1/chat/completions",
        headers: TRUSTED,
        body: { model: "test/echo", messages: [{ role: "user", content: "read secret.txt" }] },
      })
      expect(reply.status).toBe(500)
      expect(reply.json().error.code).toBe("app_dir_outside_root")
      expect(port.created).toEqual([])
    } finally {
      rmSync(join(root, "trusted"), { force: true })
    }
  })

  test("x-plugboard-opencode-tools from the session caller: absent for an untrusted app or 0 calls, exact for 1 and 3 calls, and summed across n=2 choices", async () => {
    const port = new FakeSessionPort()
    port.toolIDs.push("read", "glob", "grep")
    port.operatorRules = OPERATOR_RULES
    const sessions = createSessionStore()
    let mode: "zero" | "one" | "three" | "fanout" = "zero"
    let callIndex = 0
    port.script.prompt = async (input) => {
      const idx = callIndex++
      queueMicrotask(() => {
        const b = bus(input.sessionID)
        if (mode === "zero") {
          ;[b.textDelta("none"), b.stepEnded("stop"), b.executionSucceeded()].forEach((e) => sessions.dispatch(e))
        } else if (mode === "one") {
          ;[b.toolCalled("s1", "read", { path: "inside.txt" }), b.toolSucceeded("s1"), b.stepEnded("tool-calls"), b.textDelta("one"), b.stepEnded("stop"), b.executionSucceeded()].forEach((e) =>
            sessions.dispatch(e),
          )
        } else if (mode === "three") {
          ;[
            b.toolCalled("s1", "read", { path: "inside.txt" }),
            b.toolCalled("s2", "glob", { pattern: "*.txt" }),
            b.toolSucceeded("s1"),
            b.toolSucceeded("s2"),
            b.stepEnded("tool-calls"),
            b.toolCalled("s3", "grep", { pattern: "INSIDE" }),
            b.toolSucceeded("s3"),
            b.stepEnded("tool-calls"),
            b.textDelta("three"),
            b.stepEnded("stop"),
            b.executionSucceeded(),
          ].forEach((e) => sessions.dispatch(e))
        } else {
          const events =
            idx === 0
              ? [b.toolCalled("s1", "read", {}), b.toolSucceeded("s1"), b.stepEnded("tool-calls"), b.textDelta("c0"), b.stepEnded("stop"), b.executionSucceeded()]
              : [
                  b.toolCalled("s2", "glob", {}),
                  b.toolCalled("s3", "grep", {}),
                  b.toolSucceeded("s2"),
                  b.toolSucceeded("s3"),
                  b.stepEnded("tool-calls"),
                  b.textDelta("c1"),
                  b.stepEnded("stop"),
                  b.executionSucceeded(),
                ]
          events.forEach((e) => sessions.dispatch(e))
        }
      })
    }

    const caller = createSessionCaller({ port, sessions, maxTools: 4, apps: APPS })
    server = await startRoute({ caller, options: OPTIONS })
    const ask = (headers: Record<string, string>, extra: Record<string, unknown> = {}) =>
      server!.send({
        method: "POST",
        path: "/v1/chat/completions",
        headers,
        body: { model: "test/echo", messages: [{ role: "user", content: "run" }], ...extra },
      })

    mode = "zero"
    expect((await ask(PLAIN)).headers["x-plugboard-opencode-tools"]).toBeUndefined()
    expect((await ask(TRUSTED)).headers["x-plugboard-opencode-tools"]).toBeUndefined()

    mode = "one"
    expect((await ask(TRUSTED)).headers["x-plugboard-opencode-tools"]).toBe("1")

    mode = "three"
    expect((await ask(TRUSTED)).headers["x-plugboard-opencode-tools"]).toBe("3")

    mode = "fanout"
    callIndex = 0
    expect((await ask(TRUSTED, { n: 2 })).headers["x-plugboard-opencode-tools"]).toBe("3")
  })

  // #417 end to end: a fake host reloads the session each step (the stored prompt, then the calls and results so far). The
  // stub model asks for `read` until its history holds the result, then answers. A broken continuation loops until the cap.
  test("#417 a multi-message request with a server read: the second step answers from the result, one server call", async () => {
    const MARKER = "SURFACE_INSIDE_7391"
    const port = new FakeSessionPort()
    port.toolIDs.push("read", "glob", "grep")
    port.operatorRules = OPERATOR_RULES
    const sessions = createSessionStore()
    const spy = spyContext({ directory: "/data/trusted" })
    Effect.runSync(Effect.scoped(installSessionHooks(spy.ctx, { maxTools: 4, sessions, active: () => true, apps: APPS })))
    const runHook = spy.registered<(event: unknown) => Effect.Effect<void>>("session.hook")
    const hostStep = (sessionID: string, messages: unknown[]): ContextHookEvent => {
      const event: ContextHookEvent = { sessionID, system: ["host"], messages: messages as never, tools: hostTools() }
      Effect.runSync(runHook(event))
      return event
    }
    let asks = 0
    port.script.prompt = async (input) => {
      queueMicrotask(() => {
        const b = bus(input.sessionID)
        const prompt = { content: [{ type: "text", text: input.text }] }
        const history: unknown[] = []
        for (let step = 0; step < 3; step++) {
          const event = hostStep(input.sessionID, [prompt, ...history])
          if (JSON.stringify(event.messages).includes(MARKER)) {
            ;[b.textDelta(MARKER), b.stepEnded("stop"), b.executionSucceeded()].forEach((e) => sessions.dispatch(e))
            return
          }
          asks++
          const id = `s${asks}`
          history.push({ content: [{ type: "tool-call", id, name: "read", input: { path: "inside.txt" } }] })
          history.push({ content: [{ type: "tool-result", id, name: "read", result: { type: "text", value: MARKER } }] })
          ;[b.toolCalled(id, "read", { path: "inside.txt" }), b.toolSucceeded(id), b.stepEnded("tool-calls")].forEach((e) => sessions.dispatch(e))
        }
        ;[b.textDelta("NO RESULT"), b.stepEnded("stop"), b.executionSucceeded()].forEach((e) => sessions.dispatch(e))
      })
    }

    const caller = createSessionCaller({ port, sessions, maxTools: 4, apps: APPS })
    server = await startRoute({ caller, options: OPTIONS })
    const reply = await server.send({
      method: "POST",
      path: "/v1/chat/completions",
      headers: TRUSTED,
      body: {
        model: "test/echo",
        messages: [
          { role: "system", content: "You read files." },
          { role: "user", content: "Read inside.txt." },
          { role: "assistant", content: "I will read it." },
          { role: "user", content: "Use read exactly once on inside.txt, then return its exact content." },
        ],
      },
    })
    expect(reply.status).toBe(200)
    expect(reply.headers["x-plugboard-opencode-tools"]).toBe("1")
    expect(reply.json().choices[0].message.content).toBe(MARKER)
    expect(asks).toBe(1)
  })

  // #421: the request decoders keep `toolChoice: "none"` when the caller sends no `tools` array, so no server tool is offered.
  test("#421 opencodeTools: tool_choice none without caller tools offers no opencodeTools on the route", async () => {
    const port = new FakeSessionPort()
    port.toolIDs.push("read", "glob", "grep")
    port.operatorRules = OPERATOR_RULES
    const sessions = createSessionStore()
    const spy = spyContext({ directory: "/data/trusted" })
    Effect.runSync(Effect.scoped(installSessionHooks(spy.ctx, { maxTools: 4, sessions, active: () => true, apps: APPS })))
    const runHook = spy.registered<(event: unknown) => Effect.Effect<void>>("session.hook")

    let offeredTools: Record<string, HostToolDescriptor> | undefined
    port.script.prompt = async (input) => {
      const evObj: ContextHookEvent = {
        sessionID: input.sessionID,
        system: ["host"],
        messages: [{ content: [{ type: "text", text: input.text }] }],
        tools: hostTools(),
      }
      Effect.runSync(runHook(evObj))
      offeredTools = evObj.tools
      queueMicrotask(() => {
        const b = bus(input.sessionID)
        ;[b.textDelta("DENIED"), b.stepEnded("stop"), b.executionSucceeded()].forEach((e) => sessions.dispatch(e))
      })
    }

    const caller = createSessionCaller({ port, sessions, maxTools: 4, apps: APPS })
    server = await startRoute({ caller, options: OPTIONS })
    const reply = await server.send({
      method: "POST",
      path: "/v1/chat/completions",
      headers: TRUSTED,
      body: {
        model: "test/echo",
        tool_choice: "none",
        messages: [{ role: "user", content: "Read inside.txt using read. If read is not offered, say DENIED." }],
      },
    })
    expect(reply.status).toBe(200)
    expect(offeredTools).toEqual({})
  })
})

// ---------------------------------------------------------------- 2. remoteImages on the wire

describe("#408 2. remoteImages refusals and fetch limits on the wire", () => {
  let imageServer: Loopback
  let imageHits = 0
  let redirectTarget = "http://127.0.0.1/private.png"

  beforeAll(async () => {
    imageServer = await listen((request, response: ServerResponse) => {
      imageHits++
      const url = request.url ?? "/"
      if (url.startsWith("/redirect")) {
        response.writeHead(302, { location: redirectTarget })
        response.end()
        return
      }
      if (url === "/wrong-type") {
        response.writeHead(200, { "content-type": "text/plain" })
        response.end("not an image")
        return
      }
      if (url === "/oversize-declared") {
        response.writeHead(200, { "content-type": "image/png", "content-length": "2048" })
        response.end(Buffer.alloc(2048, 0x41))
        return
      }
      if (url === "/oversize-streamed") {
        response.writeHead(200, { "content-type": "image/png", "transfer-encoding": "chunked" })
        response.write(Buffer.alloc(700, 0x41))
        response.end(Buffer.alloc(700, 0x42))
        return
      }
      response.writeHead(200, { "content-type": "image/png" })
      response.end(PNG)
    })
  })

  afterAll(async () => {
    await imageServer.close()
  })

  async function sendImageUrl(url: string, remoteImages: PlugboardOptions["remoteImages"] = true) {
    const port = new FakeSessionPort()
    const sessions = createSessionStore()
    port.script.prompt = async (input) => {
      queueMicrotask(() => {
        const b = bus(input.sessionID)
        ;[b.textDelta("seen"), b.stepEnded("stop"), b.executionSucceeded()].forEach((e) => sessions.dispatch(e))
      })
    }
    const caller = createSessionCaller({ port, sessions, maxTools: 4, remoteImages })
    server = await startRoute({ caller, options: { models: ["test/*"], remoteImages } })
    const reply = await server.send({
      method: "POST",
      path: "/v1/chat/completions",
      body: {
        model: "test/vision",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "What is in this image?" },
              { type: "image_url", image_url: { url } },
            ],
          },
        ],
      },
    })
    await server.close()
    server = undefined
    return { reply, port }
  }

  test.each([
    ["octal IPv4 loopback 0177.0.0.1", () => `http://0177.0.0.1:${imageServer.port}/ok.png`],
    ["shorthand IPv4 loopback 127.1", () => `http://127.1:${imageServer.port}/ok.png`],
  ])("refuses %s with 400 image_fetch_failed before connecting or creating a session", async (_name, makeUrl) => {
    const before = imageHits
    const { reply, port } = await sendImageUrl(makeUrl(), true)
    expect(reply.status).toBe(400)
    expect(reply.json().error).toMatchObject({ type: "invalid_request_error", code: "image_fetch_failed" })
    expect(imageHits).toBe(before)
    expect(port.created).toEqual([])
  })

  test.each([
    ["unlisted loopback IP 127.0.0.1", () => `http://127.0.0.1:${imageServer.port}/ok.png`],
    ["octal loopback 0177.0.0.1", () => `http://0177.0.0.1:${imageServer.port}/ok.png`],
    ["RFC 1918 10.0.0.1", () => "http://10.0.0.1/a.png"],
  ])("refuses a redirect from an allowed localhost URL to %s with 400 image_fetch_failed and no session", async (_name, makeTarget) => {
    redirectTarget = makeTarget()
    const before = imageHits
    const { reply, port } = await sendImageUrl(`http://localhost:${imageServer.port}/redirect`, {
      allow: ["localhost"],
      maxRedirects: 2,
      maxBytes: 1024,
      timeoutMs: 2_000,
    })
    expect(reply.status).toBe(400)
    expect(reply.json().error).toMatchObject({ type: "invalid_request_error", code: "image_fetch_failed" })
    expect(imageHits).toBe(before + 1)
    expect(port.created).toEqual([])
  })

  test("refuses wrong content type and declared or streamed oversize bodies with 400 and no session, and accepts a valid PNG within maxBytes", async () => {
    const policy = { allow: ["localhost"], maxRedirects: 1, maxBytes: 1024, timeoutMs: 2_000 }

    const wrongType = await sendImageUrl(`http://localhost:${imageServer.port}/wrong-type`, policy)
    expect(wrongType.reply.status).toBe(400)
    expect(wrongType.reply.json().error.code).toBe("invalid_image")
    expect(wrongType.port.created).toEqual([])

    const oversizeDeclared = await sendImageUrl(`http://localhost:${imageServer.port}/oversize-declared`, policy)
    expect(oversizeDeclared.reply.status).toBe(400)
    expect(oversizeDeclared.reply.json().error.code).toBe("image_too_large")
    expect(oversizeDeclared.port.created).toEqual([])

    const oversizeStreamed = await sendImageUrl(`http://localhost:${imageServer.port}/oversize-streamed`, policy)
    expect(oversizeStreamed.reply.status).toBe(400)
    expect(oversizeStreamed.reply.json().error.code).toBe("image_too_large")
    expect(oversizeStreamed.port.created).toEqual([])

    const valid = await sendImageUrl(`http://localhost:${imageServer.port}/ok.png`, policy)
    expect(valid.reply.status).toBe(200)
    expect(valid.port.prompted[0]?.files).toEqual([{ name: "image-1", uri: `data:image/png;base64,${PNG.toString("base64")}` }])
  })
})

// ---------------------------------------------------------------- 3. No-keys mode on the wire

describe("#408 3. No-keys mode: Host and Origin refusals across routes", () => {
  test.each([
    ["nip.io loopback domain", (port: number) => `127.0.0.1.nip.io:${port}`, {}],
    ["foreign Host with X-Forwarded-Host behind trustProxy", (port: number) => `attacker.invalid:${port}`, { "x-forwarded-host": "localhost:4304", "x-forwarded-for": "127.0.0.1" }],
  ])("keyless route refuses Host (%s) with 403 invalid_host across routes", async (_name, makeHost, extraHeaders) => {
    const caller = new FakeModelCaller([ev.text("never"), ev.finish()])
    server = await startRoute({ caller, options: { listen: { trustProxy: true } } })
    const headers = { host: makeHost(server.port), ...extraHeaders }

    for (const [path, method, body] of [
      ["/v1/chat/completions", "POST", { model: "test/echo", messages: [{ role: "user", content: "hi" }] }],
      ["/v1/responses", "POST", { model: "test/echo", input: "hi" }],
      ["/v1/messages", "POST", { model: "test/echo", max_tokens: 16, messages: [{ role: "user", content: "hi" }] }],
      ["/plugboard/status", "GET", undefined],
    ] as const) {
      const reply = await server.send({ method, path, headers, ...(body ? { body } : {}) })
      expect(reply.status).toBe(403)
      if (path === "/v1/messages") {
        expect(reply.json()).toMatchObject({ type: "error", error: { type: "permission_error", message: "Host header not allowed" } })
      } else if (path === "/plugboard/status") {
        expect(reply.json().type).toContain("#invalid-host")
      } else {
        expect(reply.json().error.code).toBe("invalid_host")
      }
    }
    expect(caller.calls).toEqual([])
  })

  test.each([
    ["null origin", "null"],
    ["same host and port origin", "same"],
  ])("keyless route refuses Origin (%s) and preflight OPTIONS with 403 cross_origin_forbidden", async (_name, rawOrigin) => {
    const caller = new FakeModelCaller([ev.text("never"), ev.finish()])
    server = await startRoute({ caller })
    const origin = rawOrigin === "same" ? `http://127.0.0.1:${server.port}` : rawOrigin

    const inits: SendInit[] = [
      { method: "POST", path: "/v1/chat/completions", headers: { origin }, body: { model: "test/echo", messages: [{ role: "user", content: "hi" }] } },
      { method: "POST", path: "/v1/responses", headers: { origin }, body: { model: "test/echo", input: "hi" } },
      { method: "POST", path: "/v1/messages", headers: { origin }, body: { model: "test/echo", max_tokens: 16, messages: [{ role: "user", content: "hi" }] } },
      { method: "GET", path: "/plugboard/status", headers: { origin } },
      { method: "OPTIONS", path: "/v1/chat/completions", headers: { origin, "access-control-request-method": "POST" } },
    ]
    for (const init of inits) {
      const reply = await server.send(init)
      expect(reply.status).toBe(403)
      if (init.path === "/v1/messages") {
        expect(reply.json().error.type).toBe("permission_error")
      } else if (init.path === "/plugboard/status") {
        expect(reply.json().type).toContain("#cross-origin-forbidden")
      } else {
        expect(reply.json().error.code).toBe("cross_origin_forbidden")
      }
    }
    expect(caller.calls).toEqual([])
  })
})

// ---------------------------------------------------------------- 4. Response cache on the wire

describe("#408 4. Response cache isolation and wire options", () => {
  const SCRIPT: Script = [ev.reasoning("plan"), ev.text("SURFACE_CACHE_8412"), ev.finish("stop", { inputTokens: 12, outputTokens: 6, reasoningTokens: 2 })]

  async function startCachedServer() {
    const fake = new FakeModelCaller(SCRIPT)
    const rawOptions = {
      models: ["test/*"],
      aliases: { fast: "test/echo" },
      responseCache: { ttlSeconds: 300 },
      keys: { plain: "k-plain", second: "k-second" },
      apps: {
        plain: { reasoningOutput: false },
        second: { reasoningOutput: true },
      },
    }
    server = await startRoute({
      caller: withResponseCache(fake, testOptions(rawOptions)),
      options: rawOptions,
    })
    return fake
  }

  const chat = (appKey: string, overrides: Record<string, unknown> = {}): SendInit => ({
    method: "POST",
    path: "/v1/chat/completions",
    headers: { authorization: `Bearer ${appKey}` },
    body: {
      model: "fast",
      messages: [{ role: "user", content: "Reply with SURFACE_CACHE_8412" }],
      max_tokens: 128,
      temperature: 0,
      user: "alice",
      ...overrides,
    },
  })

  test("two apps do not share a cache entry, and per-app reasoningOutput is respected on both misses and hits", async () => {
    const fake = await startCachedServer()

    const plainMiss = await server!.send(chat("k-plain"))
    expect(plainMiss.status).toBe(200)
    expect(plainMiss.headers["x-plugboard-cache"]).toBe("miss")
    expect(plainMiss.json().choices[0].message.reasoning_content).toBeUndefined()

    const plainHit = await server!.send(chat("k-plain"))
    expect(plainHit.headers["x-plugboard-cache"]).toBe("hit")
    expect(plainHit.json().choices[0].message.reasoning_content).toBeUndefined()
    expect(fake.calls).toHaveLength(1)

    const secondMiss = await server!.send(chat("k-second"))
    expect(secondMiss.status).toBe(200)
    expect(secondMiss.headers["x-plugboard-cache"]).toBe("miss")
    expect(secondMiss.json().choices[0].message.reasoning_content).toBe("plan")
    expect(fake.calls).toHaveLength(2)

    const secondHit = await server!.send(chat("k-second"))
    expect(secondHit.headers["x-plugboard-cache"]).toBe("hit")
    expect(secondHit.json().choices[0].message.reasoning_content).toBe("plan")
    expect(fake.calls).toHaveLength(2)
  })

  test.each([
    ["stop", { stop: ["NEVER_STOP"] }],
    ["temperature", { temperature: 0.2 }],
    ["tools", { tools: [{ type: "function", function: { name: "noop", parameters: { type: "object", properties: {} } } }] }],
    ["reasoning_effort", { reasoning_effort: "high" }],
  ])("a request differing only in %s does not share the cached entry", async (_field, diff) => {
    const fake = await startCachedServer()

    expect((await server!.send(chat("k-plain"))).headers["x-plugboard-cache"]).toBe("miss")
    expect((await server!.send(chat("k-plain"))).headers["x-plugboard-cache"]).toBe("hit")
    expect(fake.calls).toHaveLength(1)

    const miss = await server!.send(chat("k-plain", diff))
    expect(miss.status).toBe(200)
    expect(miss.headers["x-plugboard-cache"]).toBe("miss")
    expect(fake.calls).toHaveLength(2)

    const hit = await server!.send(chat("k-plain", diff))
    expect(hit.status).toBe(200)
    expect(hit.headers["x-plugboard-cache"]).toBe("hit")
    expect(fake.calls).toHaveLength(2)
  })

  test("two end users on different apps do not share a cache entry", async () => {
    const fake = await startCachedServer()

    const alicePlain = await server!.send(chat("k-plain", { user: "alice" }))
    expect(alicePlain.headers["x-plugboard-cache"]).toBe("miss")
    expect(fake.calls).toHaveLength(1)

    const bobSecond = await server!.send(chat("k-second", { user: "bob" }))
    expect(bobSecond.headers["x-plugboard-cache"]).toBe("miss")
    expect(fake.calls).toHaveLength(2)
  })

  // `user` is not listed under "What counts as the same request" in `docs/configuration.md`, so two
  // end users on the same app share one cached entry (#278).
  test("#278 within one app, two end users share a cache entry", async () => {
    const fake = await startCachedServer()

    const alicePlain = await server!.send(chat("k-plain", { user: "alice" }))
    expect(alicePlain.headers["x-plugboard-cache"]).toBe("miss")
    expect(fake.calls).toHaveLength(1)

    const bobPlain = await server!.send(chat("k-plain", { user: "bob" }))
    expect(bobPlain.headers["x-plugboard-cache"]).toBe("hit")
    expect(fake.calls).toHaveLength(1)
  })
})
