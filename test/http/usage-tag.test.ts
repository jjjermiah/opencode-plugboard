/**
 * The usage tag over loopback HTTP: `x-plugboard-tag` on every model route family reaches the per-tag usage counts and the request log line; a bad tag is ignored, never a 4xx;
 * `GET /plugboard/usage` reports the tags, `?tag=` narrows them, and an app key sees only its own app's tags.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { setLogLevel } from "../../src/log.js"
import { createUsageRecorder, createUsageState, withUsage, type UsageRecorder, type UsageReport } from "../../src/usage.js"
import { CATALOG, ev, until } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"
import { FakeStorage } from "../support/usage.js"

const logs = captureLogs()

const TAG = "x-plugboard-tag"
const chat = (headers: Record<string, string> = {}, extra: Record<string, unknown> = {}): SendInit => ({
  method: "POST",
  path: "/v1/chat/completions",
  headers,
  body: { model: "test/echo", messages: [{ role: "user", content: "hi" }], ...extra },
})

/** One request on each model route family, carrying `headers`. */
const families = (headers: Record<string, string>): Array<[string, SendInit]> => [
  ["chat", chat(headers)],
  ["completions", { method: "POST", path: "/v1/completions", headers, body: { model: "test/echo", prompt: "hi" } }],
  ["responses", { method: "POST", path: "/v1/responses", headers, body: { model: "test/echo", input: "hi" } }],
  ["messages", { method: "POST", path: "/v1/messages", headers, body: { model: "test/echo", max_tokens: 8, messages: [{ role: "user", content: "hi" }] } }],
  ["gemini", { method: "POST", path: "/v1beta/models/test%2Fecho:generateContent", headers, body: { contents: [{ role: "user", parts: [{ text: "hi" }] }] } }],
]

let server: RouteServer | undefined
let recorder: UsageRecorder | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
  recorder = undefined
  setLogLevel("info")
})

/** A route answering every call with 10 input and 5 output tokens, with usage on. */
async function start(options?: Record<string, unknown>, script?: ConstructorParameters<typeof FakeModelCaller>[0]): Promise<RouteServer> {
  recorder = createUsageRecorder({ state: createUsageState(), storage: new FakeStorage(), loadCatalog: async () => CATALOG, retentionDays: 90 })
  const caller = withUsage(new FakeModelCaller(script ?? (() => [ev.text("hi"), ev.finish("stop", { inputTokens: 10, outputTokens: 5 })])), recorder)
  server = await startRoute({ caller, ...(options ? { options } : {}), usage: recorder })
  return server
}

const tagsOf = async (app = "default") => ((await recorder!.query({ app })) as UsageReport).apps[app]?.tags ?? {}

describe("the usage tag reaches the counts on every model route", () => {
  test.each(["chat", "completions", "responses", "messages", "gemini"])("%s: x-plugboard-tag counts the request, its tokens and no error", async (family) => {
    const srv = await start()
    const [, send] = families({ [TAG]: "cron" }).find(([name]) => name === family)!
    const reply = await srv.send(send)
    expect(reply.status).toBe(200)
    await until(async () => (await tagsOf()).cron?.tokens === 15, 1_000, `${family} tagged`)
    expect(await tagsOf()).toEqual({ cron: { requests: 1, tokens: 15, costUsd: 0, errors: 0 } })
  })

  test("two tagged requests and one untagged: the tags split the app's usage, and the totals keep all three", async () => {
    const srv = await start()
    await srv.send(chat({ [TAG]: "cron" }))
    await srv.send(chat({ [TAG]: "cron" }))
    await srv.send(chat({ [TAG]: "interactive" }))
    await srv.send(chat())
    await until(async () => ((await recorder!.query({ app: "default" })) as UsageReport).apps.default?.totals.tokens.output === 20, 1_000, "all counted")
    const report = ((await srv.send({ path: "/plugboard/usage" })).json() as UsageReport).apps.default!
    expect(report.tags).toEqual({ cron: { requests: 2, tokens: 30, costUsd: 0, errors: 0 }, interactive: { requests: 1, tokens: 15, costUsd: 0, errors: 0 } })
    expect(report.totals.requests).toBe(4)
  })

  test("a failed request counts as an error under its tag", async () => {
    const srv = await start({}, () => [ev.error({ status: 502, kind: "server", message: "boom" })])
    expect((await srv.send(chat({ [TAG]: "cron" }))).status).toBe(502)
    await until(async () => (await tagsOf()).cron?.requests === 1, 1_000, "failure counted")
    expect((await tagsOf()).cron).toMatchObject({ requests: 1, errors: 1, tokens: 0 })
  })

  test("a request the decoder refuses is still counted under its tag", async () => {
    const srv = await start()
    expect((await srv.send(chat({ [TAG]: "cron" }, { model: "" }))).status).toBe(400)
    await until(async () => (await tagsOf()).cron?.requests === 1, 1_000, "refusal counted")
    expect((await tagsOf()).cron).toMatchObject({ requests: 1, errors: 1 })
  })
})

describe("only the header names a tag", () => {
  test("a metadata.tag in the body is not read", async () => {
    const srv = await start()
    expect((await srv.send(chat({}, { metadata: { tag: "batch" } }))).status).toBe(200)
    await until(async () => ((await recorder!.query({ app: "default" })) as UsageReport).apps.default?.totals.requests === 1, 1_000, "counted")
    expect(await tagsOf()).toEqual({})
  })
})

describe("a bad tag never breaks a call", () => {
  test.each([
    ["a space", "bad tag"],
    ["a slash", "a/b"],
    ["too long", "x".repeat(65)],
    ["a comma list", "cron, chat"],
    ["__proto__", "__proto__"],
    ["_other", "_other"],
    ["constructor", "constructor"],
  ])("%s: the call answers 200, no tag is counted, and nothing leaks into the log", async (_label, value) => {
    setLogLevel("debug")
    const srv = await start()
    for (const [family, send] of families({ [TAG]: value })) {
      const reply = await srv.send(send)
      expect({ family, status: reply.status }).toEqual({ family, status: 200 })
      // No response header says so: a bad tag is ignored, not reported.
      expect(Object.keys(reply.headers).filter((name) => name.includes("tag"))).toEqual([])
    }
    await until(async () => ((await recorder!.query({ app: "default" })) as UsageReport).apps.default?.totals.requests === 5, 1_000, "five counted")
    expect(await tagsOf()).toEqual({})
    expect(logs.of("request.tag_ignored")).toHaveLength(5)
    expect(logs.of("request").every((line) => line.fields.tag === undefined)).toBe(true)
    expect(logs.lines.some((line) => line.raw.includes("bad tag") || line.raw.includes("a/b"))).toBe(false)
    expect(({} as Record<string, unknown>).requests).toBeUndefined()
  })

  test("a blank tag header is no tag and logs no ignored line", async () => {
    setLogLevel("debug")
    const srv = await start()
    expect((await srv.send(chat({ [TAG]: "   " }))).status).toBe(200)
    await until(async () => ((await recorder!.query({ app: "default" })) as UsageReport).apps.default?.totals.requests === 1, 1_000, "counted")
    expect(await tagsOf()).toEqual({})
    expect(logs.of("request.tag_ignored")).toEqual([])
  })
})

describe("the usage tag in the request log, metrics and cache", () => {
  test("a kept tag is a field of the request log line; an untagged request has none", async () => {
    const srv = await start()
    await srv.send(chat({ [TAG]: "cron" }))
    await srv.send(chat())
    const lines = logs.of("request")
    expect(lines[0]!.fields).toMatchObject({ app: "default", tag: "cron" })
    expect(lines[1]!.fields).not.toHaveProperty("tag")
  })

  test("Prometheus metrics carry no tag label", async () => {
    const srv = await start({ metrics: true })
    await srv.send(chat({ [TAG]: "cron-metrics-probe" }))
    await until(async () => (await tagsOf())["cron-metrics-probe"]?.requests === 1, 1_000, "counted")
    const text = (await srv.send({ path: "/plugboard/metrics" })).text
    expect(text).toContain("plugboard_requests_total")
    expect(text).not.toContain("cron-metrics-probe")
    expect(text).not.toMatch(/\btag=/)
  })

  test("the preflight lets a browser send x-plugboard-tag", async () => {
    const srv = await start({ cors: { origins: ["https://app.example.com"] } })
    const reply = await srv.send({
      method: "OPTIONS",
      path: "/v1/chat/completions",
      headers: { origin: "https://app.example.com", "access-control-request-method": "POST", "access-control-request-headers": TAG },
    })
    expect(reply.status).toBe(204)
    expect(reply.headers["access-control-allow-headers"]!.split(", ")).toContain(TAG)
  })
})

describe("GET /plugboard/usage: tags", () => {
  test("?tag= narrows each app's tags to one tag, and the totals stay whole", async () => {
    const srv = await start()
    await srv.send(chat({ [TAG]: "cron" }))
    await srv.send(chat({ [TAG]: "interactive" }))
    await until(async () => Object.keys(await tagsOf()).length === 2 && (await tagsOf()).interactive!.tokens === 15, 1_000, "both counted")
    const cron = (await srv.send({ path: "/plugboard/usage?tag=cron" })).json() as UsageReport
    expect(Object.keys(cron.apps.default!.tags!)).toEqual(["cron"])
    expect(cron.apps.default!.totals.requests).toBe(2)
    const none = (await srv.send({ path: "/plugboard/usage?tag=nothing" })).json() as UsageReport
    expect(none.apps.default!.tags).toEqual({})
    // The user and tag filters are independent.
    const both = (await srv.send({ path: "/plugboard/usage?tag=cron&user=nobody" })).json() as UsageReport
    expect(Object.keys(both.apps.default!.tags!)).toEqual(["cron"])
    expect(both.apps.default!.users).toEqual({})
  })

  test("a tag filter that is not a tag is a 400 naming the parameter; a stored or reserved name is a 200", async () => {
    const srv = await start()
    const bad = await srv.send({ path: "/plugboard/usage?tag=a%20b" })
    expect(bad.status).toBe(400)
    expect(bad.json()).toMatchObject({ code: "invalid_tag", param: "tag" })
    for (const tag of ["_other", "prototype", "constructor", "__proto__"]) expect({ tag, status: (await srv.send({ path: `/plugboard/usage?tag=${tag}` })).status }).toEqual({ tag, status: 200 })
  })

  test("an app key reads only its own app's tags (another app is a 403); the admin key reads every app's", async () => {
    const keys = { alpha: "key-alpha-secret", beta: "key-beta-secret" }
    const admin = "root-key-secret"
    const bearer = (key: string) => ({ authorization: `Bearer ${key}` })
    const srv = await start({ keys, adminKey: admin })
    await srv.send(chat({ ...bearer(keys.alpha), [TAG]: "alpha-cron" }))
    await srv.send(chat({ ...bearer(keys.beta), [TAG]: "beta-cron" }))
    await until(async () => (await tagsOf("alpha"))["alpha-cron"]?.requests === 1 && (await tagsOf("beta"))["beta-cron"]?.requests === 1, 1_000, "both apps counted")

    const own = (await srv.send({ path: "/plugboard/usage?tag=alpha-cron", headers: bearer(keys.alpha) })).json() as UsageReport
    expect(Object.keys(own.apps)).toEqual(["alpha"])
    expect(Object.keys(own.apps.alpha!.tags!)).toEqual(["alpha-cron"])
    expect((await srv.send({ path: "/plugboard/usage?app=beta", headers: bearer(keys.alpha) })).status).toBe(403)
    expect(JSON.stringify((await srv.send({ path: "/plugboard/usage", headers: bearer(keys.alpha) })).json())).not.toContain("beta-cron")

    const all = (await srv.send({ path: "/plugboard/usage", headers: bearer(admin) })).json() as UsageReport
    expect(Object.keys(all.apps).sort()).toEqual(["alpha", "beta"])
    expect(Object.keys(all.apps.alpha!.tags!)).toEqual(["alpha-cron"])
    expect(Object.keys(all.apps.beta!.tags!)).toEqual(["beta-cron"])
    const narrowed = (await srv.send({ path: "/plugboard/usage?tag=beta-cron", headers: bearer(admin) })).json() as UsageReport
    expect(narrowed.apps.alpha!.tags).toEqual({})
    expect(Object.keys(narrowed.apps.beta!.tags!)).toEqual(["beta-cron"])
  })
})
