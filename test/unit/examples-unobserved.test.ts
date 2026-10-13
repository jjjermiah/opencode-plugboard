/**
 * `unobserved` checks in the TypeScript runner helpers (examples/_harness/ts/harness.ts), keyed by scenario id alone or by
 * id|variant (#370). A check left out of its row is named in the note, and an entry that names no check, or drops every
 * check, is refused before anything runs.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { runAll } from "../../examples/_harness/ts/harness.ts"

let capture: ReturnType<typeof Bun.serve>
let lines: Array<Record<string, unknown>>
let logSpy: ReturnType<typeof spyOn>
const S1_OBSERVATIONS = { text: "pong", finish_reason: "stop" } // no usage: the client does not expose it

beforeEach(() => {
  capture = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 204 }) })
  process.env.PLUGBOARD_CAPTURE_URL = `http://127.0.0.1:${capture.port}`
  lines = []
  logSpy = spyOn(console, "log").mockImplementation((text: unknown) => {
    lines.push(JSON.parse(String(text)) as Record<string, unknown>)
  })
})

afterEach(() => {
  logSpy.mockRestore()
  capture.stop(true)
  delete process.env.PLUGBOARD_CAPTURE_URL
})

const results = () => lines.filter((line) => line.kind === "result") as Array<{ status: string; checks: Array<{ name: string; ok: boolean }>; note: string | null; model: string }>

describe("#370 unobserved checks without a variant", () => {
  test("an id-only entry leaves the check out of every model's row, and the note names it", async () => {
    await runAll({ S1: async () => S1_OBSERVATIONS }, { unobserved: { S1: { "usage present": "the client does not expose usage" } } })
    const rows = results()
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.status).toBe("pass")
      expect(row.checks.map((check) => check.name)).not.toContain("usage present")
      expect(row.note).toBe("not checked, usage present: the client does not expose usage")
    }
  })

  test("without the entry the same observations fail the usage check", async () => {
    await runAll({ S1: async () => S1_OBSERVATIONS }, {})
    expect(results().every((row) => row.status === "fail")).toBe(true)
  })

  test("an entry that names a check the scenario does not have is refused before anything runs", async () => {
    await expect(runAll({ S1: async () => S1_OBSERVATIONS }, { unobserved: { S1: { "no such check": "why" } } })).rejects.toThrow('names no check "no such check"')
    expect(lines).toEqual([])
  })

  test("an entry that would drop every check of its row is refused", async () => {
    const all = { "answer contains pong": "x", "finish_reason is stop": "x", "usage present": "x" }
    await expect(runAll({ S1: async () => S1_OBSERVATIONS }, { unobserved: { S1: all } })).rejects.toThrow("would drop every check")
    expect(lines).toEqual([])
  })

  test("a key with more than one | is refused, so no exclusion is silently dropped", async () => {
    await expect(runAll({ S1: async () => S1_OBSERVATIONS }, { unobserved: { "S1|chat|typo": { "usage present": "x" } } })).rejects.toThrow("more than one |")
    expect(lines).toEqual([])
  })

  test("an entry for a scenario that is not planned is refused", async () => {
    await expect(runAll({ S1: async () => S1_OBSERVATIONS }, { unobserved: { S6: { "calories is a number": "x" } } })).rejects.toThrow("names no planned scenario variant")
  })
})
