import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { UsageRpc, usageHandlers } from "../../src/rpc.js"
import { emptyDay, summaryOf, type UsageQuery, type UsageReport } from "../../src/usage.js"

const report = (query: UsageQuery): UsageReport => ({
  from: query.from ?? "2026-09-12",
  to: query.to ?? "2026-10-11",
  generatedAt: "2026-10-11T12:00:00.000Z",
  totals: summaryOf(emptyDay()),
  apps: {},
})

/** A handler context: `error` builds the declared error value, the way the host's does. */
const context = { error: (type: string, message: string, data?: unknown) => ({ type, message, data }) }

describe("the usage RPC contract", () => {
  test("the id is opencode-plugboard.usage, with one method `get` and no events", () => {
    expect(UsageRpc.id).toBe("opencode-plugboard.usage")
    expect(Object.keys(UsageRpc.methods)).toEqual(["get"])
    expect(UsageRpc.events).toEqual({})
  })

  test("the input is the optional query fields; the errors include invalid_query", () => {
    const { input, errors } = UsageRpc.methods.get
    expect(Object.keys((input as { properties: Record<string, unknown> }).properties)).toEqual(["from", "to", "app", "user"])
    expect(Object.keys(errors ?? {})).toEqual(["invalid_query"])
  })
})

describe("the usage RPC handler", () => {
  test("returns the report of the query, and passes the query fields through", async () => {
    const seen: UsageQuery[] = []
    const get = usageHandlers({
      query: async (query) => {
        seen.push(query)
        return report(query)
      },
    }).get
    const result = await Effect.runPromise(get({ from: "2026-10-01", to: "2026-10-30", app: "alpha" }, context as never))
    expect(seen).toEqual([{ from: "2026-10-01", to: "2026-10-30", app: "alpha" }])
    expect(result).toEqual(report({ from: "2026-10-01", to: "2026-10-30" }))
  })

  test("the user filter passes through unchanged, reserved and stored names included", async () => {
    const seen: UsageQuery[] = []
    const get = usageHandlers({
      query: async (query) => {
        seen.push(query)
        return report(query)
      },
    }).get
    for (const user of ["_other", "prototype", "constructor", "__proto__"]) await Effect.runPromise(get({ user }, context as never))
    expect(seen.map((query) => query.user)).toEqual(["_other", "prototype", "constructor", "__proto__"])
  })

  test("no input, or fields of the wrong type, read as no filter (every app, the default range)", async () => {
    const seen: UsageQuery[] = []
    const get = usageHandlers({
      query: async (query) => {
        seen.push(query)
        return report(query)
      },
    }).get
    await Effect.runPromise(get(undefined, context as never))
    await Effect.runPromise(get({ from: 5, app: ["x"] }, context as never))
    expect(seen).toEqual([
      { from: undefined, to: undefined, app: undefined },
      { from: undefined, to: undefined, app: undefined },
    ])
  })

  test("a bad query fails with the declared invalid_query error, naming the parameter", async () => {
    const get = usageHandlers({
      query: async () => ({ status: 400, kind: "invalid_request", code: "invalid_date", param: "from", message: "`from` must be a UTC date, YYYY-MM-DD" }),
    }).get
    const failure = await Effect.runPromise(Effect.flip(get({ from: "2026-02-30" }, context as never)))
    expect<unknown>(failure).toEqual({ type: "invalid_query", message: "`from` must be a UTC date, YYYY-MM-DD", data: { param: "from" } })
  })
})
