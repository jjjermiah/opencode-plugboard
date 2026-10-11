/**
 * The process runtime's generation list and the shared listener (src/runtime.ts,
 * docs/architecture.md "Why state is process-wide"): who is accepted, who serves, how options
 * are adopted on reload, and the listener's lifetime across generations.
 */
import { describe, expect, jest, test } from "bun:test"
import { ensureBackend, loadServingCatalog, registerGeneration, sessionStore } from "../../src/runtime.js"
import { ensureAppDir } from "../../src/session/history.js"
import { CATALOG, model, plugRequest, until } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { listen } from "../support/loopback.js"
import { FakeHistoryPort } from "../support/session.js"
import { freePort, generation, isolateRuntime } from "../support/runtime.js"

const logs = captureLogs()
isolateRuntime()

/** GET / on the runtime's listener: the serving generation's name, or the 503 body. */
async function whoServes(port: number): Promise<string> {
  const reply = await fetch(`http://127.0.0.1:${port}/`).catch(() => undefined)
  if (!reply) return "refused"
  return reply.status === 503 ? `503 ${((await reply.json()) as { error: { message: string } }).error.message}` : await reply.text()
}

async function listening(port: number) {
  await until(() => logs.of("listener.listening").length > 0, 1_000, "the listener to bind")
  return port
}

describe("accepting generations", () => {
  test("the first generation binds the listener and serves", async () => {
    const port = await freePort()
    const registration = registerGeneration(generation("a", { port }))
    expect(registration.accepted).toBe(true)
    await listening(port)
    expect(await whoServes(port)).toBe("a")
  })

  test("later generations with equal options join; the newest serves", async () => {
    const port = await freePort()
    registerGeneration(generation("a", { port, options: { models: ["test/*"], maxTools: 4 } }))
    // Key order differs: options compare as key-sorted JSON.
    const b = registerGeneration(generation("b", { port, options: { maxTools: 4, models: ["test/*"] } }))
    expect(b.accepted).toBe(true)
    await listening(port)
    expect(await whoServes(port)).toBe("b")
  })

  test("a generation whose options differ from the live ones is rejected, logged once", async () => {
    const port = await freePort()
    registerGeneration(generation("a", { port }))
    const b = registerGeneration(generation("b", { port, options: { models: ["other/*"] } }))
    const c = registerGeneration(generation("c", { port, options: { models: ["other/*"] } }))
    expect([b.accepted, c.accepted]).toEqual([false, false])
    expect(b.confirmed()).toBe(false)
    expect(logs.of("listener.options_mismatch")).toHaveLength(1)
    await listening(port)
    expect(await whoServes(port)).toBe("a")
  })

  test("a generation with another listen address is rejected; listen needs a restart", async () => {
    const port = await freePort()
    registerGeneration(generation("a", { port }))
    expect(registerGeneration(generation("b", { port: port + 1 })).accepted).toBe(false)
    expect(logs.of("listener.listen_mismatch")).toHaveLength(1)
  })

  test("when no generation is live, the next one's options are adopted (config reload)", async () => {
    const port = await freePort()
    registerGeneration(generation("a", { port })).dispose()
    const b = registerGeneration(generation("b", { port, options: { models: ["other/*"] } }))
    expect(b.accepted).toBe(true)
    await listening(port)
    expect(await whoServes(port)).toBe("b")
    // ...and are then the live ones.
    expect(registerGeneration(generation("c", { port })).accepted).toBe(false)
  })
})

describe("who serves", () => {
  test("the newest generation in a confirmed app directory wins over newer ones elsewhere", async () => {
    const port = await freePort()
    const directory = (await ensureAppDir("app")) as string
    registerGeneration(generation("app-dir", { port, directory })).ready()
    registerGeneration(generation("elsewhere", { port }))
    await listening(port)
    expect(await whoServes(port)).toBe("elsewhere")
    expect(await ensureBackend("app", new AbortController().signal, async () => {})).toBeUndefined()
    expect(await whoServes(port)).toBe("app-dir")
  })

  test("the catalog comes from the serving generation; the caller's own is only a fallback", async () => {
    const own = async () => [model("own", "x")]
    expect(await loadServingCatalog(own)).toEqual([model("own", "x")])
    registerGeneration(generation("a", { port: await freePort(), loadCatalog: async () => CATALOG }))
    expect(await loadServingCatalog(own)).toBe(CATALOG)
  })

  test("with every generation gone, requests during the grace period get a 503", async () => {
    const port = await freePort()
    const a = registerGeneration(generation("a", { port }))
    await listening(port)
    a.dispose()
    expect(await whoServes(port)).toBe("503 plugboard is reloading")
  })

  test("a handler that throws is a 503, and the listener keeps serving", async () => {
    const port = await freePort()
    registerGeneration(generation("a", { port, handler: () => { throw new Error("bad handler") } }))
    await listening(port)
    expect(await whoServes(port)).toBe("503 plugboard handler failed")
    expect(logs.of("listener.handler_failed")[0]!.fields.error).toBe("bad handler")
  })
})

describe("the listener outlives generations by a grace period", () => {
  test("it closes once the grace passes with no generation", async () => {
    const port = await freePort()
    const a = registerGeneration(generation("a", { port }))
    await listening(port)
    jest.useFakeTimers()
    try {
      a.dispose()
      jest.advanceTimersByTime(9_999)
      expect(logs.of("listener.closed")).toEqual([])
      jest.advanceTimersByTime(1)
      expect(logs.of("listener.closed")).toHaveLength(1)
    } finally {
      jest.useRealTimers()
    }
    await until(async () => (await whoServes(port)) === "refused", 1_000, "the port to close")
  })

  test("a generation that arrives within the grace keeps the same listener", async () => {
    const port = await freePort()
    const a = registerGeneration(generation("a", { port }))
    await listening(port)
    jest.useFakeTimers()
    try {
      a.dispose()
      registerGeneration(generation("b", { port }))
      jest.advanceTimersByTime(60_000)
    } finally {
      jest.useRealTimers()
    }
    expect(logs.of("listener.closed")).toEqual([])
    expect(logs.of("listener.listening")).toHaveLength(1)
    expect(await whoServes(port)).toBe("b")
  })

  test("a port owned by someone else leaves the runtime inert, logged once", async () => {
    const taken = await listen(() => {})
    registerGeneration(generation("a", { port: taken.port }))
    registerGeneration(generation("b", { port: taken.port }))
    await until(() => logs.of("listener.address_in_use").length > 0, 1_000, "the bind failure")
    expect(logs.of("listener.address_in_use")).toHaveLength(1)
    expect(logs.of("listener.listening")).toEqual([])
    await taken.close()
  })
})

describe("#85 history index", () => {
  const registerSession = (sessionID: string) =>
    sessionStore().register({ sessionID, app: "app", requestID: "r", request: plugRequest(), collector: { push() {} } })

  test("with no limits, registering a request session writes nothing to host storage", async () => {
    const history = new FakeHistoryPort()
    registerGeneration(generation("a", { port: await freePort(), history: { port: history, limits: {} } }))
    registerSession("ses_1")
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(history.entries.size).toBe(0)
  })

  test("with a limit, each registered session is indexed under history/<app>/<created>/<id>", async () => {
    const history = new FakeHistoryPort()
    registerGeneration(generation("a", { port: await freePort(), history: { port: history, limits: { maxSessions: 10 } } }))
    registerSession("ses_1")
    await until(() => history.entries.size === 1, 1_000, "the index entry")
    expect([...history.entries.keys()][0]).toMatch(/^history\/app\/\d{15}\/ses_1$/)
  })
})
