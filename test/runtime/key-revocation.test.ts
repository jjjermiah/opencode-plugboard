/**
 * #90: a key removed or rotated by a config reload stops working on the live listener. A config reload disposes
 * the Location's generations and registers the edited config as a new one; with no generation live
 * its options are adopted (docs/architecture.md, "Key revocation"). When an older generation stays
 * live (an app directory that has not reloaded) and is the one serving, a newer generation whose
 * keys only revoke or rotate is accepted and its key set replaces the live one at once; any other
 * difference is still rejected until restart (I5). Real OpenAI route on the real listener, so
 * authentication is the code that answers.
 */
import { describe, expect, test } from "bun:test"
import { createOpenAiRoute } from "../../src/openai/route.js"
import { createResponseState, createResponseStore } from "../../src/responses/state.js"
import { registerGeneration } from "../../src/runtime.js"
import { FakeStorage } from "../support/usage.js"
import { CATALOG, testOptions, until } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { FakeModelCaller } from "../support/model-caller.js"
import { RUNTIME_KEY, freePort, generation, isolateRuntime } from "../support/runtime.js"

const logs = captureLogs()
isolateRuntime()

/** A generation whose handler is the OpenAI route, with these keys (one app per key), in `directory`. */
function serving(name: string, port: number, keys: Record<string, string>, extra: Record<string, unknown> = {}, directory = `/projects/${name}`) {
  const options = testOptions({ listen: { host: "127.0.0.1", port }, keys, ...extra })
  const handler = createOpenAiRoute({ options, caller: new FakeModelCaller([]), loadCatalog: async () => CATALOG, responses: createResponseStore({ storage: new FakeStorage(), state: createResponseState() }) })
  return generation(name, { port, options, handler, directory })
}

/** Marks `directory` as a confirmed app directory, as `ensureBackend` does for a request (the runtime's `confirmed` set). */
function confirm(directory: string): void {
  ;((globalThis as Record<symbol, unknown>)[RUNTIME_KEY] as { confirmed: Set<string> }).confirmed.add(directory)
}

/** The status the live listener answers an authenticated route with, for this bearer key. */
async function answers(port: number, key: string): Promise<number> {
  return (await fetch(`http://127.0.0.1:${port}/v1/models`, { headers: { authorization: `Bearer ${key}` } })).status
}

describe("#152 removing the last key while an older generation serves fails closed", () => {
  test("every request gets 401 (no key, the old key, a keyless request) and adding a key back needs a restart", async () => {
    const port = await freePort()
    const old = registerGeneration(serving("old", port, { alpha: "key-alpha" }, {}, "/projects/app-a"))
    expect(old.accepted).toBe(true)
    confirm("/projects/app-a") // the older generation keeps serving; it has not reloaded
    await until(() => logs.of("listener.listening").length > 0, 1_000, "the listener to bind")
    expect(await answers(port, "key-alpha")).toBe(200)

    // The reload removes the last key. The new generation is accepted (the removal applies at once), but keyless is not.
    expect(registerGeneration(serving("next", port, {}, {}, "/projects/app-b")).accepted).toBe(true)
    expect(await answers(port, "key-alpha")).toBe(401)
    expect((await fetch(`http://127.0.0.1:${port}/v1/models`)).status).toBe(401)

    // A key added by a later reload is a change the live listener rejects until restart (I5).
    expect(registerGeneration(serving("again", port, { alpha: "key-alpha" }, {}, "/projects/app-c")).accepted).toBe(false)
    expect(await answers(port, "key-alpha")).toBe(401)
  })
})

describe("#90 a key dropped by a config reload is rejected by the live listener", () => {
  test("after the reload the dropped key gets a 401 and the kept key still answers", async () => {
    const port = await freePort()
    const before = registerGeneration(serving("before", port, { alpha: "key-alpha", beta: "key-beta" }))
    await until(() => logs.of("listener.listening").length > 0, 1_000, "the listener to bind")
    expect(await answers(port, "key-beta")).toBe(200)

    // The reload: the Location's generation is disposed and the edited config registers in its place.
    before.dispose()
    expect(registerGeneration(serving("after", port, { alpha: "key-alpha" })).accepted).toBe(true)

    expect(await answers(port, "key-beta")).toBe(401)
    expect(await answers(port, "key-alpha")).toBe(200)
  })

  test("an older generation still live and serving stops accepting a key the newer config drops", async () => {
    const port = await freePort()
    const old = registerGeneration(serving("old", port, { alpha: "key-alpha", beta: "key-beta" }, {}, "/projects/app-a"))
    expect(old.accepted).toBe(true)
    confirm("/projects/app-a") // the app directory the old generation serves; it has not reloaded
    await until(() => logs.of("listener.listening").length > 0, 1_000, "the listener to bind")

    // The newer config removes beta. It is accepted (keys only revoke) and the old generation's listener applies it.
    const next = registerGeneration(serving("next", port, { alpha: "key-alpha" }, {}, "/projects/app-b"))
    expect(next.accepted).toBe(true)
    expect(logs.of("listener.keys_updated").map((line) => line.fields)).toEqual([expect.objectContaining({ removed: "1", rotated: "0" })])

    expect(await answers(port, "key-beta")).toBe(401)
    expect(await answers(port, "key-alpha")).toBe(200)
  })

  test("a changed key value takes effect at once: the old value gets a 401, the new one answers", async () => {
    const port = await freePort()
    const old = registerGeneration(serving("old", port, { alpha: "key-alpha", beta: "key-beta" }, {}, "/projects/app-a"))
    expect(old.accepted).toBe(true)
    confirm("/projects/app-a")
    await until(() => logs.of("listener.listening").length > 0, 1_000, "the listener to bind")

    expect(registerGeneration(serving("next", port, { alpha: "key-alpha-2", beta: "key-beta" }, {}, "/projects/app-b")).accepted).toBe(true)

    expect(await answers(port, "key-alpha")).toBe(401)
    expect(await answers(port, "key-alpha-2")).toBe(200)
    expect(await answers(port, "key-beta")).toBe(200)
  })

  test("a newer config that adds a key with other differences is still rejected until restart", async () => {
    const port = await freePort()
    const old = registerGeneration(serving("old", port, { alpha: "key-alpha", beta: "key-beta" }, {}, "/projects/app-a"))
    expect(old.accepted).toBe(true)
    confirm("/projects/app-a")
    await until(() => logs.of("listener.listening").length > 0, 1_000, "the listener to bind")

    // Not a revocation: a new app name and a different `maxTools` (I5). The live options stay in force.
    const next = registerGeneration(serving("next", port, { alpha: "key-alpha", beta: "key-beta", gamma: "key-gamma" }, { maxTools: 7 }, "/projects/app-b"))
    expect(next.accepted).toBe(false)
    expect(logs.of("listener.options_mismatch").length).toBeGreaterThan(0)

    expect(await answers(port, "key-gamma")).toBe(401)
    expect(await answers(port, "key-beta")).toBe(200)
  })

  test("a rejected generation that differs in non-key options does not change the live keys", async () => {
    const port = await freePort()
    const old = registerGeneration(serving("old", port, { alpha: "key-alpha", beta: "key-beta" }, {}, "/projects/app-a"))
    expect(old.accepted).toBe(true)
    confirm("/projects/app-a")
    await until(() => logs.of("listener.listening").length > 0, 1_000, "the listener to bind")

    // Drops beta, but `maxTools` also differs: rejected as a whole, so beta keeps answering.
    const next = registerGeneration(serving("next", port, { alpha: "key-alpha" }, { maxTools: 7 }, "/projects/app-b"))
    expect(next.accepted).toBe(false)
    expect(logs.of("listener.keys_updated")).toHaveLength(0)

    expect(await answers(port, "key-beta")).toBe(200)
    expect(await answers(port, "key-alpha")).toBe(200)
  })
})
