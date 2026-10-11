import { describe, expect, test } from "bun:test"
import { raceAbort } from "../../src/abort.js"

describe("#133 raceAbort", () => {
  test("settles with the promise's value or error while the signal is live", async () => {
    const controller = new AbortController()
    expect(await raceAbort(Promise.resolve(1), controller.signal)).toBe(1)
    await expect(raceAbort(Promise.reject(new Error("boom")), controller.signal)).rejects.toThrow("boom")
  })

  test("rejects with the abort reason when the signal aborts first, and observes the late result", async () => {
    const controller = new AbortController()
    let fail: (error: Error) => void = () => {}
    const slow = new Promise<number>((_resolve, reject) => (fail = reject))
    const raced = raceAbort(slow, controller.signal)
    const reason = new Error("gone")
    controller.abort(reason)
    await expect(raced).rejects.toBe(reason)
    fail(new Error("late")) // would be an unhandled rejection if the promise were not observed
    await Promise.resolve()
  })

  test("an aborted signal rejects at once", async () => {
    const controller = new AbortController()
    controller.abort(new Error("already"))
    await expect(raceAbort(new Promise(() => {}), controller.signal)).rejects.toThrow("already")
  })
})
