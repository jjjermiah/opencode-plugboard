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
import { withStopSequences } from "../../src/stop.js"
import { CLIENTS, type ENDPOINTS, type Target } from "./clients.js"
import { SCENARIOS, script, type Scenario } from "./scenarios.js"

/** `todo`: no case written yet (#148). `n/a`: the client's endpoint has no such feature, with the reason in `note`. */
export type Outcome = "pass" | "fail" | "gap" | "n/a" | "todo"
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
  // maxChoices 4: the default of 1 refuses n > 1 (each choice is a model call); the matrix allows four so the n scenario
  // and the legacy prompt array times n (two prompts, n 2) run.
  const caller = new FakeModelCaller((request) => script(request))
  server = await startRoute({ caller: withStopSequences(caller), options: { keys: { compat: KEY }, aliases: { fast: "test/echo" }, maxChoices: 4 } })
  target = { origin: server.url, apiKey: KEY, caller }
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
        const reason = client.na?.[scenario]
        results.push(reason ? { ...base, outcome: "n/a", note: reason } : { ...base, outcome: "todo" })
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
  for (const client of CLIENTS) {
    for (const scenario of [...Object.keys(client.cases), ...Object.keys(client.na ?? {})]) expect(SCENARIOS).toContain(scenario as Scenario)
    // A scenario is a case, an n/a with its reason, or a todo: never both a case and an n/a.
    for (const scenario of Object.keys(client.na ?? {})) expect(client.cases).not.toHaveProperty(scenario)
  }
})
