/**
 * The relay for the Go and .NET runners (#362): it turns each `observation` line into a `result` line by applying the
 * checks in examples/_shared/scenarios.json, and passes every other line through unchanged.
 */
import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

const relay = fileURLToPath(new URL("../../examples/_harness/ts/relay.ts", import.meta.url))

async function through(lines: ReadonlyArray<unknown>): Promise<Array<Record<string, unknown>>> {
  const input = lines.map((line) => JSON.stringify(line)).join("\n") + "\n"
  const proc = Bun.spawn(["bun", relay], { stdin: new Blob([input]), stdout: "pipe", stderr: "pipe" })
  const output = await new Response(proc.stdout).text()
  expect(await proc.exited).toBe(0)
  return output
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe("#362 the relay applies the scenario checks to a runner's observations", () => {
  test("plan, client and done lines pass through unchanged", async () => {
    const plan = { kind: "plan", scenarios: ["S1"] }
    const client = { kind: "client", name: "go-openai", version: "1.43.0", runtime: { name: "go", version: "1" } }
    const done = { kind: "done" }
    expect(await through([plan, client, done])).toEqual([plan, client, done])
  })

  test("an observation that meets every S1 check is a pass", async () => {
    const [result] = await through([
      { kind: "observation", scenario: "S1", model: "fast", error: null, observations: { text: "pong", finish_reason: "stop", usage: { total_tokens: 9 } } },
    ])
    expect(result).toMatchObject({ kind: "result", scenario: "S1", model: "fast", status: "pass", error: null })
    expect((result!.checks as Array<{ ok: boolean }>).every((check) => check.ok)).toBe(true)
  })

  test("an observation that misses a check is a fail, and the failing check is named", async () => {
    const [result] = await through([
      { kind: "observation", scenario: "S1", model: "fast", error: null, observations: { text: "hello", finish_reason: "stop", usage: { total_tokens: 9 } } },
    ])
    expect(result!.status).toBe("fail")
    const checks = result!.checks as Array<{ name: string; ok: boolean }>
    expect(checks.find((check) => check.name === "answer contains pong")?.ok).toBe(false)
  })

  test("an observation with an error is a fail with no checks, and the error text is kept", async () => {
    const [result] = await through([{ kind: "observation", scenario: "S1", model: "fast", error: "APIError: boom", observations: {} }])
    expect(result).toMatchObject({ status: "fail", checks: [], error: "APIError: boom" })
  })
})
