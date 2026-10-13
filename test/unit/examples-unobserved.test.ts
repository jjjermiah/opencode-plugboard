/**
 * The `unobserved` option of the TypeScript runner helper (examples/_harness/ts/harness.ts, #343). An entry must name a
 * planned scenario variant and one of its checks, and must leave at least one check, so a renamed check cannot leave a
 * stale entry and a row cannot pass with no checks. The refusals come before any scenario is marked or run.
 */
import { describe, expect, test } from "bun:test"
import { runAll } from "../../examples/_harness/ts/harness.ts"

const functions = { S1: async () => ({ text: "pong" }) }

describe("unobserved entries are checked before the run", () => {
  test("a check name that the scenario does not have is refused", async () => {
    await expect(runAll(functions, { variants: { S1: ["chat"] }, unobserved: { "S1|chat": { "renamed check": "gone" } } })).rejects.toThrow(
      'unobserved S1|chat names no check "renamed check"',
    )
  })

  test("a key whose variant is not planned for the scenario is refused", async () => {
    await expect(runAll(functions, { variants: { S1: ["chat"] }, unobserved: { "S1|responses": { "finish_reason is stop": "x" } } })).rejects.toThrow(
      "unobserved S1|responses names no planned scenario variant",
    )
  })

  test("an entry that would drop every check of the row is refused", async () => {
    const all = { "answer contains pong": "x", "finish_reason is stop": "x", "usage present": "x" }
    await expect(runAll(functions, { variants: { S1: ["chat"] }, unobserved: { "S1|chat": all } })).rejects.toThrow(
      "unobserved S1|chat would drop every check of the row",
    )
  })
})
