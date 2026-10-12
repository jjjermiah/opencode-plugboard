import { describe, expect, test } from "bun:test"
import { parseOptions } from "../../src/config.js"
import type { CallContext, ModelCaller, PlugEvent, PlugRequest, ServedModel } from "../../src/contract.js"
import { withFallbacks } from "../../src/fallback.js"
import { resolveModel } from "../../src/models.js"
import { collect, ev, model, plugRequest } from "../support/fixtures.js"

const CATALOG = [model("a", "x"), model("b", "y", { variants: ["low"] }), model("c", "z")]
const options = parseOptions({
  models: ["a/*", "b/*", "c/*"],
  aliases: { chain: ["a/x", "b/y#low", "c/z"], one: ["a/x"], plain: "a/x" },
})
const rateLimited = ev.error({ status: 429, kind: "rate_limit", code: "rate_limited" })

/** One script per attempt: events to yield, or an Error to throw. */
type Script = PlugEvent[] | Error
function scripted(scripts: Script[]) {
  const targets: string[] = []
  const closed: boolean[] = []
  const caller: ModelCaller = {
    stream(request: PlugRequest, context: CallContext) {
      const i = targets.length
      targets.push(`${request.ref.providerID}/${request.ref.id}`)
      return (async function* () {
        try {
          context.onRecord?.(`rec${i}`)
          const script = scripts[i]!
          if (script instanceof Error) throw script
          yield* script
        } finally {
          closed[i] = true
        }
      })()
    },
  }
  return { caller, targets, closed }
}

const chainRequest = (name = "chain") => plugRequest({ model: name, ref: resolveModel(options, name, CATALOG) as never })

async function run(scripts: Script[], name = "chain", signal = new AbortController().signal) {
  const fake = scripted(scripts)
  const retried: string[] = []
  const records: string[] = []
  const served: ServedModel[] = []
  const request = chainRequest(name)
  const caller = withFallbacks(fake.caller, { options, loadCatalog: async () => CATALOG, onFallback: (app) => retried.push(app) })
  let events: PlugEvent[] = []
  let thrown: unknown
  try {
    events = await collect(caller.stream(request, { app: "app1", signal, onRecord: (id) => records.push(id), onServed: (s) => served.push(s) }))
  } catch (error) {
    thrown = error
  }
  return { ...fake, retried, records, served, events, thrown }
}

describe("alias lists in the options", () => {
  test("the first target is the alias, the rest are its fallbacks; one entry is a plain alias", () => {
    expect(options.aliases).toEqual({ chain: "a/x", one: "a/x", plain: "a/x" })
    expect(options.fallbacks).toEqual({ chain: ["b/y#low", "c/z"] })
  })

  test.each([
    ["empty list", []],
    ["target outside the allowlist", ["a/x", "d/q"]],
    ["non-string target", ["a/x", 3]],
    ["malformed target", ["nope"]],
  ])("%s is refused", (_name, list) => {
    expect(() => parseOptions({ models: ["a/*"], aliases: { f: list } })).toThrow(/plugboard alias/)
  })
})

describe("withFallbacks", () => {
  test("a rate limit before output moves to the next target, in a fresh call", async () => {
    const r = await run([[rateLimited], [ev.text("hi"), ev.finish()]])
    expect(r.targets).toEqual(["a/x", "b/y"])
    expect(r.events.map((e) => e.type)).toEqual(["text-delta", "finish"])
    expect(r.served).toEqual([{ model: "b/y#low", fallbacks: 1, chain: true }])
    expect(r.records).toEqual(["rec1"])
    expect(r.retried).toEqual(["app1"])
    expect(r.closed).toEqual([true, true])
  })

  test("a thrown error or an empty stream counts as a failure", async () => {
    const r = await run([new Error("boom"), [], [ev.text("ok"), ev.finish()]])
    expect(r.targets).toEqual(["a/x", "b/y", "c/z"])
    expect(r.served).toEqual([{ model: "c/z", fallbacks: 2, chain: true }])
  })

  test("a failure after the first event is never retried", async () => {
    const r = await run([[ev.text("par"), ev.error({ code: "provider_unavailable" })], [ev.text("never")]])
    expect(r.targets).toEqual(["a/x"])
    expect(r.events.map((e) => e.type)).toEqual(["text-delta", "error"])
    const late = await run([[ev.reasoning("hm"), ev.error({ code: "provider_unavailable" })], [ev.text("never")]])
    expect(late.targets).toEqual(["a/x"])
  })

  test.each(["context_length_exceeded", "content_filter", "provider_rejected_request", "backend_unavailable"])("%s is not retried", async (code) => {
    const r = await run([[ev.error({ status: 400, kind: "invalid_request", code })], [ev.text("never")]])
    expect(r.targets).toEqual(["a/x"])
    expect(r.served).toEqual([])
    expect(r.retried).toEqual([])
  })

  test("when every target fails the last error is the answer and nothing is served", async () => {
    const last = ev.error({ status: 429, kind: "rate_limit", code: "quota_exceeded" })
    const r = await run([[rateLimited], [ev.error({ status: 504, kind: "timeout", code: "provider_timeout" })], [last]])
    expect(r.targets).toEqual(["a/x", "b/y", "c/z"])
    expect(r.events).toEqual([last])
    expect(r.served).toEqual([])
    expect(r.records).toEqual(["rec2"])
    const thrown = await run([new Error("e0"), new Error("e1"), new Error("e2")])
    expect((thrown.thrown as Error).message).toBe("e2")
  })

  test("an aborted request ends the chain: the failure stands", async () => {
    const controller = new AbortController()
    const fake = scripted([[rateLimited], [ev.text("never")]])
    const inner = fake.caller
    const caller = withFallbacks(
      {
        stream(request, context) {
          const stream = inner.stream(request, context)
          controller.abort(new Error("deadline"))
          return stream
        },
      },
      { options, loadCatalog: async () => CATALOG },
    )
    const events = await collect(caller.stream(chainRequest(), { app: "app1", signal: controller.signal }))
    expect(fake.targets).toEqual(["a/x"])
    expect(events).toEqual([rateLimited])
  })

  test("a plain alias or model id is not retried, and its answer names its model (#279)", async () => {
    const r = await run([[rateLimited], [ev.text("never")]], "plain")
    expect(r.targets).toEqual(["a/x"])
    expect(r.retried).toEqual([])
    expect(r.served).toEqual([])
    const answered = await run([[ev.text("hi"), ev.finish()]], "plain")
    expect(answered.targets).toEqual(["a/x"])
    expect(answered.served).toEqual([{ model: "a/x", fallbacks: 0 }])
  })

  test("#279 a plain call that fails before any output reports no served model", async () => {
    const r = await run([[ev.error({ status: 400, kind: "invalid_request", code: "context_length_exceeded" })]], "plain")
    expect(r.served).toEqual([])
  })

  test("a fallback that the server does not offer is skipped", async () => {
    const fake = scripted([[rateLimited], [ev.text("ok"), ev.finish()]])
    const caller = withFallbacks(fake.caller, { options, loadCatalog: async () => [CATALOG[0]!, CATALOG[2]!] })
    await collect(caller.stream(chainRequest(), { app: "app1", signal: new AbortController().signal }))
    expect(fake.targets).toEqual(["a/x", "c/z"])
  })

  test("the consumer leaving early closes the answering attempt", async () => {
    const fake = scripted([[ev.text("a"), ev.text("b"), ev.text("c")]])
    const caller = withFallbacks(fake.caller, { options, loadCatalog: async () => CATALOG })
    for await (const _ of caller.stream(chainRequest(), { app: "app1", signal: new AbortController().signal })) break
    expect(fake.closed).toEqual([true])
  })
})
