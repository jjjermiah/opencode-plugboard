/**
 * `ensureBackend`, the per-directory readiness gate the session caller awaits before
 * `session.create` (docs/architecture.md "Backend readiness"). Fails closed: every way the app
 * directory's generation can be missing ends in a 503 `backend_unavailable`, never in a session
 * that no context hook would rewrite.
 */
import { describe, expect, jest, test } from "bun:test"
import { mkdirSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { ensureBackend, registerGeneration, sessionStore } from "../../src/runtime.js"
import { ensureAppDir } from "../../src/session/history.js"
import { gate } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { freePort, generation, installForeignRuntime, isolateRuntime } from "../support/runtime.js"

const logs = captureLogs()
isolateRuntime()

const signal = () => new AbortController().signal
const appDir = async (app = "app") => (await ensureAppDir(app)) as string
const unavailable = (message: string | RegExp) => ({ status: 503, kind: "server" as const, code: "backend_unavailable", message: expect.stringMatching(message) as string })

describe("ensureBackend", () => {
  test("an app directory with a ready generation is ready without booting anything", async () => {
    const boot = jest.fn(async () => {})
    registerGeneration(generation("app", { port: await freePort(), directory: await appDir() })).ready()
    expect(await ensureBackend("app", signal(), boot)).toBeUndefined()
    expect(boot).not.toHaveBeenCalled()
  })

  test("no generation there yet: it boots the Location, which loads the plugin there", async () => {
    const port = await freePort()
    const directory = await appDir()
    const boot = jest.fn(async (at: string) => {
      // What the host does on `ctx.agent.list({ location })`: load the plugin in that Location.
      registerGeneration(generation("app", { port, directory: at })).ready()
    })
    expect(await ensureBackend("app", signal(), boot)).toBeUndefined()
    expect(boot.mock.calls).toEqual([[directory]])
  })

  test("the directory is confirmed before booting, so the Location sees it at setup", async () => {
    const port = await freePort()
    let confirmedAtSetup: boolean | undefined
    await ensureBackend("app", signal(), async (directory) => {
      const registration = registerGeneration(generation("app", { port, directory }))
      confirmedAtSetup = registration.confirmed()
      registration.ready()
    })
    expect(confirmedAtSetup).toBe(true)
  })

  test("a generation set up before its directory was confirmed is refreshed once, even for concurrent requests", async () => {
    const refresh = jest.fn(async () => {})
    const registration = registerGeneration(generation("app", { port: await freePort(), directory: await appDir(), refresh }))
    registration.ready()
    expect(registration.confirmed()).toBe(false)
    const results = await Promise.all([ensureBackend("app", signal(), async () => {}), ensureBackend("app", signal(), async () => {})])
    expect(results).toEqual([undefined, undefined])
    expect(registration.confirmed()).toBe(true)
    expect(refresh).toHaveBeenCalledTimes(1)
    await ensureBackend("app", signal(), async () => {})
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  test("a generation there that was rejected (options differ) is a 503 at once, without booting", async () => {
    const port = await freePort()
    registerGeneration(generation("live", { port }))
    registerGeneration(generation("app", { port, directory: await appDir(), options: { models: ["other/*"] } }))
    const boot = jest.fn(async () => {})
    expect(await ensureBackend("app", signal(), boot)).toEqual(unavailable(/rejected/))
    expect(boot).not.toHaveBeenCalled()
  })

  test("a boot that fails is a 503, logged", async () => {
    expect(await ensureBackend("app", signal(), async () => Promise.reject(new Error("no such location")))).toEqual(unavailable("Could not start the plugboard app directory"))
    expect(logs.of("backend.boot_failed")[0]!.fields).toMatchObject({ app: "app", error: "no such location" })
  })

  test("a request that ends while waiting is a 503, and the boot is abandoned, not awaited", async () => {
    const controller = new AbortController()
    const booting = gate()
    const result = ensureBackend("app", controller.signal, () => (booting.open(), new Promise(() => {})))
    await booting.promise
    controller.abort()
    expect(await result).toEqual(unavailable("The request ended before the app directory was ready"))
  })

  test("a request that already ended is a 503 before anything boots", async () => {
    const controller = new AbortController()
    controller.abort()
    const boot = jest.fn(async () => {})
    expect(await ensureBackend("app", controller.signal, boot)).toEqual(unavailable("The request ended"))
    expect(boot).not.toHaveBeenCalled()
  })

  test("a Location that never becomes ready times out after 15 s with a 503", async () => {
    const booting = gate()
    jest.useFakeTimers()
    try {
      const result = ensureBackend("app", signal(), () => (booting.open(), new Promise(() => {})))
      await booting.promise
      jest.advanceTimersByTime(15_000)
      expect(await result).toEqual(unavailable("Timed out waiting for the plugboard app directory to load its backend"))
    } finally {
      jest.useRealTimers()
    }
  })

  test("an app directory that resolves outside the data root (symlink) fails closed", async () => {
    const root = join(process.env.XDG_DATA_HOME!, "opencode-plugboard")
    const outside = join(process.env.XDG_DATA_HOME!, "elsewhere")
    mkdirSync(root, { recursive: true })
    mkdirSync(outside, { recursive: true })
    symlinkSync(outside, join(root, "evil"))
    const boot = jest.fn(async () => {})
    expect(await ensureBackend("evil", signal(), boot)).toEqual({ status: 500, kind: "server", code: "app_dir_outside_root", message: "The app directory resolves outside the plugboard data root" })
    expect(boot).not.toHaveBeenCalled()
  })
})

describe("a runtime written by another plugboard version", () => {
  test("stays inert: generations are rejected, nothing listens, ensureBackend is a 503", async () => {
    installForeignRuntime(99)
    const port = await freePort()
    const registration = registerGeneration(generation("a", { port }))
    expect(registration.accepted).toBe(false)
    expect(await ensureBackend("app", signal(), async () => {})).toEqual(unavailable("A different plugboard runtime owns this server process; restart the server"))
    expect(await fetch(`http://127.0.0.1:${port}/`).catch(() => "refused")).toBe("refused")
  })

  test("its session store is a detached one, never the foreign runtime's", () => {
    installForeignRuntime(99)
    const store = sessionStore()
    expect(store).toBe(sessionStore())
    expect((globalThis as Record<symbol, unknown>)[Symbol.for("opencode-plugboard.runtime")]).toEqual({ version: 99 })
  })
})
