/**
 * #101 The compatibility matrix: every client in `clients.ts` runs the shared scenarios of
 * `scenarios.ts` against a real plugboard route over loopback HTTP, backed by a scripted model.
 * One test per client x scenario: "<client> | <endpoint> | <scenario>".
 *
 * With PLUGBOARD_COMPAT_RESULTS set, the outcomes are written there as JSON for
 * `.github/scripts/compat-matrix.ts`, which renders the matrix for the Actions summary and
 * docs/compatibility.md.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { startRoute, type RouteServer } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"
import { CLIENTS, ENDPOINTS, type Target } from "./clients.js"
import { SCENARIOS, script, type Scenario } from "./scenarios.js"

export type Outcome = "pass" | "fail" | "gap" | "n/a"
export interface MatrixResult {
  readonly client: string
  readonly endpoint: keyof typeof ENDPOINTS
  readonly scenario: Scenario
  readonly outcome: Outcome
  readonly note?: string
}

const KEY = "compat-matrix-key"
let server: RouteServer
let target: Target
const results: MatrixResult[] = []

beforeAll(async () => {
  server = await startRoute({ caller: new FakeModelCaller((request) => script(request)), options: { keys: { compat: KEY }, aliases: { fast: "test/echo" } } })
  target = { origin: server.url, apiKey: KEY }
})

afterAll(async () => {
  await server.close()
  const file = process.env.PLUGBOARD_COMPAT_RESULTS
  if (file) writeFileSync(file, JSON.stringify(results, null, 2))
})

for (const client of CLIENTS) {
  describe(`${client.name} | ${client.endpoint}`, () => {
    for (const scenario of SCENARIOS) {
      const entry = client.cases[scenario]
      const base = { client: client.name, endpoint: client.endpoint, scenario }
      if (!entry) {
        results.push({ ...base, outcome: "n/a" })
        continue
      }
      const name = `${client.name} | ${client.endpoint} | ${scenario}`
      if (typeof entry === "function") {
        test(name, async () => {
          try {
            await entry(target)
            results.push({ ...base, outcome: "pass" })
          } catch (error) {
            results.push({ ...base, outcome: "fail", note: String(error).split("\n")[0]!.slice(0, 200) })
            throw error
          }
        })
      } else {
        // A known gap: expected to fail. When it starts passing, `test.failing` fails: flip it to a plain case.
        test.failing(`${name} (known gap)`, async () => {
          results.push({ ...base, outcome: "gap", note: entry.gap })
          await entry.run(target)
        })
      }
    }
  })
}

test("every client covers every scenario its endpoint supports, or says why not", () => {
  expect(results.length + CLIENTS.reduce((sum, client) => sum + Object.keys(client.cases).length, 0)).toBeGreaterThan(0)
  for (const client of CLIENTS) for (const scenario of Object.keys(client.cases)) expect(SCENARIOS).toContain(scenario as Scenario)
})
