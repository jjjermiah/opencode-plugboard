/**
 * #52 the header's format and its accumulator, and what `withUsage` hands the front-end: the
 * totals of an answered call, before its finish event, with the cost when the model is priced.
 */
import { describe, expect, test } from "bun:test"
import type { ServerResponse } from "node:http"
import type { CallTotals, ModelRef } from "../../src/contract.js"
import { formatUsage, reportUsage, USAGE_HEADER } from "../../src/usage-header.js"
import { priceCall, type tokenBreakdown, withUsage, type UsageRecorder } from "../../src/usage.js"
import { ev, collect, plugRequest } from "../support/fixtures.js"
import { FakeModelCaller } from "../support/model-caller.js"

/** Only what the accumulator reads: the header slot and whether the headers are open. */
function fakeResponse() {
  const headers = new Map<string, string>()
  const state = { headersSent: false }
  const response = { ...state, destroyed: false, setHeader: (name: string, value: string) => void headers.set(name, value) }
  return { response: response as unknown as ServerResponse, headers, sent: () => (response.headersSent = true) }
}

const COST = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }

/** A recorder that prices tokens with the same function as the real one, against one catalog price. */
const pricing = {
  call: () => {},
  price: async (_ref: ModelRef, tokens: ReturnType<typeof tokenBreakdown>) => priceCall([COST], tokens),
} as unknown as UsageRecorder

describe("#52 x-plugboard-usage format and accumulation", () => {
  test("formatUsage: input, output and cache_read, then cost_usd with six decimals when priced", () => {
    expect(formatUsage({ inputTokens: 12, outputTokens: 3, cacheReadTokens: 0, costUsd: 0.0000321 })).toBe("input=12; output=3; cache_read=0; cache_write=0; cost_usd=0.000032")
    expect(formatUsage({ inputTokens: 12, outputTokens: 3, cacheReadTokens: 4 })).toBe("input=12; output=3; cache_read=4; cache_write=0")
  })

  test("#276 formatUsage reports cache_write next to cache_read, so a first-turn cache write is visible", () => {
    expect(formatUsage({ inputTokens: 3658, outputTokens: 9, cacheReadTokens: 0, cacheWriteTokens: 3658, costUsd: 0.00046 })).toBe(
      "input=3658; output=9; cache_read=0; cache_write=3658; cost_usd=0.000460",
    )
  })

  test("reportUsage sums each answered call; one unpriced call drops the cost for the whole response", () => {
    const { response, headers } = fakeResponse()
    const report = reportUsage(response, false)!
    report({ inputTokens: 10, outputTokens: 2, cacheReadTokens: 1, costUsd: 0.25 })
    report({ inputTokens: 5, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 4, costUsd: 0.5 })
    expect(headers.get(USAGE_HEADER)).toBe("input=15; output=3; cache_read=1; cache_write=4; cost_usd=0.750000")
    report({ inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 })
    expect(headers.get(USAGE_HEADER)).toBe("input=16; output=4; cache_read=1; cache_write=4")
  })

  test("reportUsage is undefined for a stream, and writes nothing once the headers are sent", () => {
    expect(reportUsage(fakeResponse().response, true)).toBeUndefined()
    const { response, headers, sent } = fakeResponse()
    const report = reportUsage(response, false)!
    sent()
    report({ inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, costUsd: 0 })
    expect(headers.has(USAGE_HEADER)).toBe(false)
  })
})

describe("#52 withUsage hands the front-end the totals before the finish", () => {
  const signal = () => new AbortController().signal

  test("an answered call reports its totals and the price of its tokens, before the finish is yielded", async () => {
    const seen: Array<CallTotals | "finish"> = []
    const caller = new FakeModelCaller([ev.text("hi"), ev.finish("stop", { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 200 })])
    const stream = withUsage(caller, pricing).stream(plugRequest(), { app: "a", signal: signal(), onUsage: (totals) => seen.push(totals) })
    for await (const event of stream) if (event.type === "finish") seen.push("finish")
    expect(seen).toEqual([{ inputTokens: 1000, outputTokens: 100, cacheReadTokens: 200, cacheWriteTokens: 0, costUsd: expect.any(Number) }, "finish"])
    // Uncached input is 800 tokens; cache reads are priced at their own rate.
    expect((seen[0] as CallTotals).costUsd).toBeCloseTo((800 * 3 + 100 * 15 + 200 * 0.3) / 1_000_000, 12)
  })

  test("#276 a cache write is reported as cacheWriteTokens and priced at the write rate, not as uncached input", async () => {
    const seen: CallTotals[] = []
    const caller = new FakeModelCaller([ev.text("hi"), ev.finish("stop", { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 200, cacheWriteTokens: 300 })])
    await collect(withUsage(caller, pricing).stream(plugRequest(), { app: "a", signal: signal(), onUsage: (totals) => seen.push(totals) }))
    expect(seen[0]).toMatchObject({ inputTokens: 1000, cacheReadTokens: 200, cacheWriteTokens: 300 })
    // 500 uncached input at the input rate, 300 written at the write rate, 200 read at the read rate, 100 output.
    expect(seen[0]!.costUsd).toBeCloseTo((500 * 3 + 300 * 3.75 + 200 * 0.3 + 100 * 15) / 1_000_000, 12)
  })

  test("a call that ended in an error reports no totals", async () => {
    const seen: CallTotals[] = []
    const caller = new FakeModelCaller([ev.finish("error")])
    await collect(withUsage(caller, pricing).stream(plugRequest(), { app: "a", signal: signal(), onUsage: (totals) => seen.push(totals) }))
    expect(seen).toEqual([])
  })

  test("the events of the call pass through unchanged", async () => {
    const caller = new FakeModelCaller([ev.text("hi"), ev.finish("stop")])
    expect(await collect(withUsage(caller, pricing).stream(plugRequest(), { app: "a", signal: signal() }))).toEqual([ev.text("hi"), ev.finish("stop")])
  })
})
