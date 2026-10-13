/**
 * The relay for the Go and .NET runners (#362): it turns each `observation` line into a `result` line by applying the
 * checks in examples/_shared/scenarios.json. It passes `plan`, `client` and `done` through, and refuses any other line,
 * so a runner cannot print a verdict of its own.
 */
import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

const relay = fileURLToPath(new URL("../../examples/_harness/ts/relay.ts", import.meta.url))

async function spawnRelay(lines: ReadonlyArray<unknown>): Promise<{ code: number; out: Array<Record<string, unknown>> }> {
  const input = lines.map((line) => JSON.stringify(line)).join("\n") + "\n"
  const proc = Bun.spawn(["bun", relay], { stdin: new Blob([input]), stdout: "pipe", stderr: "pipe" })
  const output = await new Response(proc.stdout).text()
  const code = await proc.exited
  const out = output
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>)
  return { code, out }
}

async function through(lines: ReadonlyArray<unknown>): Promise<Array<Record<string, unknown>>> {
  const { code, out } = await spawnRelay(lines)
  expect(code).toBe(0)
  return out
}

const observation = (observations: Record<string, unknown>, scenario = "S1") => ({
  kind: "observation",
  scenario,
  model: "fast",
  error: null,
  observations,
})

describe("#362 the relay applies the scenario checks to a runner's observations", () => {
  test("plan, client and done lines pass through unchanged", async () => {
    const plan = { kind: "plan", scenarios: ["S1"] }
    const client = { kind: "client", name: "go-openai", version: "1.43.0", runtime: { name: "go", version: "1" } }
    const done = { kind: "done" }
    expect(await through([plan, client, done])).toEqual([plan, client, done])
  })

  test("an observation that meets every S1 check is a pass", async () => {
    const [result] = await through([observation({ text: "pong", finish_reason: "stop", usage: { total_tokens: 9 } })])
    expect(result).toMatchObject({ kind: "result", scenario: "S1", model: "fast", status: "pass", error: null })
    expect((result!.checks as Array<{ ok: boolean }>).every((check) => check.ok)).toBe(true)
  })

  test("an observation that misses a check is a fail, and the failing check is named", async () => {
    const [result] = await through([observation({ text: "hello", finish_reason: "stop", usage: { total_tokens: 9 } })])
    expect(result!.status).toBe("fail")
    const checks = result!.checks as Array<{ name: string; ok: boolean }>
    expect(checks.find((check) => check.name === "answer contains pong")?.ok).toBe(false)
  })

  test("an observation with an error is a fail with no checks, and the error text is kept", async () => {
    const [result] = await through([{ kind: "observation", scenario: "S1", model: "fast", error: "APIError: boom", observations: {} }])
    expect(result).toMatchObject({ status: "fail", checks: [], error: "APIError: boom" })
  })

  test("a forged result line fails the relay and nothing is printed", async () => {
    const forged = { kind: "result", scenario: "S1", model: "fast", status: "pass", checks: [], error: null, note: null }
    const { code, out } = await spawnRelay([{ kind: "plan", scenarios: ["S1"] }, forged, { kind: "done" }])
    expect(code).not.toBe(0)
    expect(out).toEqual([])
  })

  test("a result line after done is refused too, so a runner cannot append a verdict", async () => {
    const forged = { kind: "result", scenario: "S1", model: "fast", status: "pass", checks: [], error: null, note: null }
    const { code, out } = await spawnRelay([observation({ text: "hello" }), { kind: "done" }, forged])
    expect(code).not.toBe(0)
    expect(out).toEqual([])
  })

  test("any other kind is refused, not passed through", async () => {
    const { code, out } = await spawnRelay([{ kind: "gap", scenario: "S1" }, { kind: "done" }])
    expect(code).not.toBe(0)
    expect(out).toEqual([])
  })
})
