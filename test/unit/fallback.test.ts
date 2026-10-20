import type { ServerResponse } from "node:http"
import { afterEach, describe, expect, test } from "bun:test"
import { parseOptions } from "../../src/config.js"
import type { CallContext, ModelCaller, PlugEvent, PlugRequest, ServedModel } from "../../src/contract.js"
import { reportServed, withFallbacks } from "../../src/fallback.js"
import { setLogLevel } from "../../src/log.js"
import { resolveModel } from "../../src/models.js"
import { collect, ev, model, plugRequest } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"

const CATALOG = [model("a", "x"), model("b", "y", { variants: ["low"] }), model("c", "z")]
const options = parseOptions({
  models: ["a/*", "b/*", "c/*"],
  aliases: { chain: ["a/x", "b/y#low", "c/z"], one: ["a/x"], plain: "a/x" },
})
const rateLimited = ev.error({ status: 429, kind: "rate_limit", code: "rate_limited" })

/** #262: the `model.resolved` debug line names the target that answered; at info it is not written. */
describe("#262 the model.resolved debug line", () => {
  const logs = captureLogs()
  afterEach(() => setLogLevel("info"))
  const response = { headersSent: false, destroyed: false, setHeader() {} } as unknown as ServerResponse

  test("at debug, the answering target, its fallbacks and whether it was a list alias are one line", () => {
    setLogLevel("debug")
    reportServed(response, {})({ model: "b/y#low", fallbacks: 1, chain: true })
    expect(logs.of("model.resolved")).toHaveLength(1)
    expect(logs.of("model.resolved")[0]!.fields).toEqual({ served: "b/y#low", fallbacks: "1", chain: "true" })
  })

  test("at info, no model.resolved line is written", () => {
    reportServed(response, {})({ model: "a/x", fallbacks: 0 })
    expect(logs.of("model.resolved")).toEqual([])
  })
})

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

  test("#503 a provider overload before output moves to the next target; after output it is never retried", async () => {
    const overloaded = ev.error({ status: 503, kind: "server", code: "provider_overloaded" })
    const r = await run([[overloaded], [ev.text("hi"), ev.finish()]])
    expect(r.targets).toEqual(["a/x", "b/y"])
    expect(r.served).toEqual([{ model: "b/y#low", fallbacks: 1, chain: true }])
    const late = await run([[ev.text("par"), overloaded], [ev.text("never")]])
    expect(late.targets).toEqual(["a/x"])
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

/** #391: a host retry before any output (`provider_retry`) moves the chain on at once; the last target keeps the host's retries. */
describe("#391 a host retry before any output fails an attempt that has a target after it", () => {
  const providerRetry = ev.error({ status: 503, kind: "server", code: "provider_retry", message: "The model provider failed; the next target is tried" })

  test("the retry is a failure: the next target answers, and the failed attempt is closed", async () => {
    const r = await run([[providerRetry], [ev.text("hi"), ev.finish()]])
    expect(r.targets).toEqual(["a/x", "b/y"])
    expect(r.served).toEqual([{ model: "b/y#low", fallbacks: 1, chain: true }])
    expect(r.closed).toEqual([true, true])
    expect(r.retried).toEqual(["app1"])
  })

  test("each target that is not last is told a target follows; the last one is not", async () => {
    const flags: Array<boolean | undefined> = []
    const caller = withFallbacks(
      {
        stream(_request, context) {
          flags.push(context.fallbackNext)
          const answered = flags.length === 3
          return (async function* () {
            if (answered) yield* [ev.text("hi"), ev.finish()]
            else yield providerRetry
          })()
        },
      },
      { options, loadCatalog: async () => CATALOG },
    )
    const events = await collect(caller.stream(chainRequest(), { app: "app1", signal: new AbortController().signal }))
    expect(flags).toEqual([true, true, false])
    expect(events.map((e) => e.type)).toEqual(["text-delta", "finish"])
  })

  test("the last target's retry is not a fallback: the host's answer (its error) stands", async () => {
    const r = await run([[rateLimited], [rateLimited], [providerRetry]])
    expect(r.targets).toEqual(["a/x", "b/y", "c/z"])
    expect(r.events).toEqual([providerRetry])
    expect(r.served).toEqual([])
  })
})

/** #391: `firstEventTimeoutMs`. A timed target yields each step's events after that step's wait (counted from the previous step), or never answers (`"hang"`). Like the session caller, it ends on its signal's abort. */
type Step = { readonly after: number; readonly events: PlugEvent[] }
type Timed = "hang" | Step | { readonly steps: ReadonlyArray<Step> }

/** Resolves after `ms`, or as soon as `signal` aborts; without `ms`, only on abort. */
function until(signal: AbortSignal, ms?: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = ms === undefined ? undefined : setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
    if (signal.aborted) return done()
    signal.addEventListener("abort", done, { once: true })
  })
}

function timedTargets(plan: Timed[]) {
  const targets: string[] = []
  const aborted: boolean[] = []
  const closed: boolean[] = []
  const caller: ModelCaller = {
    stream(request: PlugRequest, context: CallContext) {
      const i = targets.length
      targets.push(`${request.ref.providerID}/${request.ref.id}`)
      const step = plan[i]!
      const steps: ReadonlyArray<Step> = step === "hang" ? [] : "steps" in step ? step.steps : [step]
      return (async function* () {
        aborted[i] = false
        try {
          if (step === "hang") {
            await until(context.signal)
            aborted[i] = context.signal.aborted
            return
          }
          for (const { after, events } of steps) {
            await until(context.signal, after)
            if (context.signal.aborted) {
              aborted[i] = true
              return
            }
            yield* events
          }
        } finally {
          closed[i] = true
        }
      })()
    },
  }
  return { caller, targets, aborted, closed }
}

const DEADLINE = 400
/** Well before the deadline, so a slow runner cannot push the event past it. */
const EARLY = 50
const timedOptions = parseOptions({
  models: ["a/*", "b/*", "c/*"],
  aliases: { chain: ["a/x", "b/y#low", "c/z"], pair: ["a/x", "c/z"] },
  firstEventTimeoutMs: DEADLINE,
})

async function timedRun(plan: Timed[], name = "chain") {
  const fake = timedTargets(plan)
  const retried: string[] = []
  const served: ServedModel[] = []
  const caller = withFallbacks(fake.caller, { options: timedOptions, loadCatalog: async () => CATALOG, onFallback: (app) => retried.push(app) })
  const request = plugRequest({ model: name, ref: resolveModel(timedOptions, name, CATALOG) as never })
  const events = await collect(caller.stream(request, { app: "app1", signal: new AbortController().signal, onServed: (s) => served.push(s) }))
  return { ...fake, retried, served, events }
}

describe("#391 firstEventTimeoutMs: the first-event deadline", () => {
  const answer = [ev.text("hi"), ev.finish()]

  test("a target that never emits is aborted at the deadline, and the next target answers", async () => {
    const r = await timedRun(["hang", { after: 0, events: answer }])
    expect(r.targets).toEqual(["a/x", "b/y"])
    expect(r.aborted).toEqual([true, false])
    expect(r.closed).toEqual([true, true])
    expect(r.events.map((e) => e.type)).toEqual(["text-delta", "finish"])
    expect(r.served).toEqual([{ model: "b/y#low", fallbacks: 1, chain: true }])
    expect(r.retried).toEqual(["app1"])
  })

  test("a target that emits before the deadline keeps its answer and is not aborted", async () => {
    const r = await timedRun([{ after: EARLY, events: answer }, "hang"])
    expect(r.targets).toEqual(["a/x"])
    expect(r.aborted).toEqual([false])
    expect(r.events.map((e) => e.type)).toEqual(["text-delta", "finish"])
    expect(r.served).toEqual([{ model: "a/x", fallbacks: 0, chain: true }])
    expect(r.retried).toEqual([])
  })

  test("each target that is not last has its own deadline: two hangs, the third answers", async () => {
    const r = await timedRun(["hang", "hang", { after: 0, events: answer }])
    expect(r.targets).toEqual(["a/x", "b/y", "c/z"])
    expect(r.aborted).toEqual([true, true, false])
    expect(r.served).toEqual([{ model: "c/z", fallbacks: 2, chain: true }])
    expect(r.retried).toEqual(["app1", "app1"])
  })

  test("the last target has no first-event deadline: a slow last target still answers", async () => {
    const r = await timedRun(
      [
        { after: 0, events: [rateLimited] },
        { after: DEADLINE * 3, events: answer },
      ],
      "pair",
    )
    expect(r.targets).toEqual(["a/x", "c/z"])
    expect(r.aborted).toEqual([false, false])
    expect(r.served).toEqual([{ model: "c/z", fallbacks: 1, chain: true }])
  })

  test("a reasoning-first target is not aborted, and its stream runs past the deadline to the end", async () => {
    const r = await timedRun([
      {
        steps: [
          { after: EARLY, events: [ev.reasoning("thinking")] },
          { after: DEADLINE * 2, events: [ev.text("answer"), ev.finish()] },
        ],
      },
      "hang",
    ])
    expect(r.targets).toEqual(["a/x"])
    expect(r.aborted).toEqual([false])
    expect(r.events.map((e) => e.type)).toEqual(["reasoning-delta", "text-delta", "finish"])
    expect(r.served).toEqual([{ model: "a/x", fallbacks: 0, chain: true }])
  })

  test("a text-first target is not aborted, and its answer streamed past the deadline is whole", async () => {
    const r = await timedRun([
      {
        steps: [
          { after: EARLY, events: [ev.text("he")] },
          { after: DEADLINE * 2, events: [ev.text("llo"), ev.finish()] },
        ],
      },
      "hang",
    ])
    expect(r.targets).toEqual(["a/x"])
    expect(r.aborted).toEqual([false])
    expect(
      r.events
        .filter((e) => e.type === "text-delta")
        .map((e) => (e as { text: string }).text)
        .join(""),
    ).toBe("hello")
    expect(r.events.at(-1)).toMatchObject({ type: "finish" })
  })

  test("an abandoned attempt is cancelled by plugboard, not left by a client: the caller sees reason kind cancelled, so it gets no settle window (#391)", async () => {
    const reasons: unknown[] = []
    let calls = 0
    const caller: ModelCaller = {
      stream(_request, context) {
        const hangs = calls++ === 0
        return (async function* () {
          if (hangs) {
            await until(context.signal)
            reasons.push((context.signal.reason as { kind?: unknown } | undefined)?.kind)
            return
          }
          yield* [ev.text("hi"), ev.finish()]
        })()
      },
    }
    const events = await collect(
      withFallbacks(caller, { options: timedOptions, loadCatalog: async () => CATALOG }).stream(plugRequest({ model: "chain", ref: resolveModel(timedOptions, "chain", CATALOG) as never }), {
        app: "app1",
        signal: new AbortController().signal,
      }),
    )
    expect(reasons).toEqual(["cancelled"])
    expect(events.at(-1)).toMatchObject({ type: "finish" })
  })
})
