/**
 * #90: a key removed from the config stops working on the live listener. A config reload disposes
 * the Location's generations and registers the edited config as a new one; with no generation live
 * its options are adopted (docs/architecture.md, "Key revocation"). Real OpenAI route on the real
 * listener, so authentication is the code that answers.
 */
import { describe, expect, test } from "bun:test"
import { createOpenAiRoute } from "../../src/openai/route.js"
import { registerGeneration } from "../../src/runtime.js"
import { CATALOG, testOptions, until } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { FakeModelCaller } from "../support/model-caller.js"
import { freePort, generation, isolateRuntime } from "../support/runtime.js"

const logs = captureLogs()
isolateRuntime()

/** A generation whose handler is the OpenAI route, with these keys (one app per key). */
function serving(name: string, port: number, keys: Record<string, string>) {
  const options = testOptions({ listen: { host: "127.0.0.1", port }, keys })
  const handler = createOpenAiRoute({ options, caller: new FakeModelCaller([]), loadCatalog: async () => CATALOG })
  return generation(name, { port, options, handler })
}

/** The status the live listener answers an authenticated route with, for this bearer key. */
async function answers(port: number, key: string): Promise<number> {
  return (await fetch(`http://127.0.0.1:${port}/v1/models`, { headers: { authorization: `Bearer ${key}` } })).status
}

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
})
