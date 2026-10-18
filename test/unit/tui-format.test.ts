import { describe, expect, test } from "bun:test"
import {
  appRows,
  appValues,
  barCells,
  cell,
  formatCost,
  formatCount,
  formatInstant,
  formatLine,
  formatMs,
  formatPercent,
  modelRows,
  presetRange,
  totalItems,
  unavailableMessage,
  APP_COLUMNS,
} from "../../src/tui-format.js"
import type { UsageReport, UsageTotals } from "../../src/usage.js"

const NOON_2026_10_11 = Date.parse("2026-10-11T12:00:00Z")

const totals = (over: Partial<UsageTotals> = {}): UsageTotals => ({
  requests: 0,
  errors: { client: 0, server: 0, timeout: 0, disconnected: 0 },
  latency: { count: 0, sumMs: 0, buckets: [], p50Ms: null, p95Ms: null },
  tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 },
  costUsd: 0,
  cacheHits: 0,
  cacheMisses: 0,
  fallbacks: 0,
  limited: 0,
  unpricedRequests: 0,
  ...over,
})

const appReport = (requests: number, costUsd: number, models: Record<string, { requests: number; tokens: number; costUsd: number }>, over: Partial<UsageTotals> = {}) => ({
  totals: totals({ requests, costUsd, ...over }),
  models,
  days: [],
})

/** Two apps: `chat` spent most, `embed` has requests but no price. */
const report: UsageReport = {
  from: "2026-10-05",
  to: "2026-10-11",
  generatedAt: "2026-10-11T12:00:00.000Z",
  totals: totals({ requests: 12, costUsd: 3.5 }),
  apps: {
    embed: appReport(4, 0, { "openai/text-embed": { requests: 4, tokens: 900, costUsd: 0 } }, { tokens: { input: 900, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 } }),
    chat: appReport(
      8,
      3.5,
      {
        "anthropic/sonnet": { requests: 5, tokens: 12_000, costUsd: 3 },
        "openai/gpt": { requests: 3, tokens: 4_000, costUsd: 0.5 },
      },
      {
        errors: { client: 1, server: 1, timeout: 0, disconnected: 0 },
        tokens: { input: 10_000, cacheRead: 5_000, cacheWrite: 0, output: 1_000, reasoning: 0 },
        latency: { count: 8, sumMs: 0, buckets: [], p50Ms: 500, p95Ms: 2_500 },
        lastRequestAt: "2026-10-11T09:30:15.000Z",
        cacheHits: 3,
        cacheMisses: 1,
      },
    ),
  },
}

describe("#142 TUI range presets", () => {
  test.each([
    ["today", "2026-10-11", "2026-10-11"],
    ["week", "2026-10-05", "2026-10-11"],
    ["month", "2026-09-12", "2026-10-11"],
    ["quarter", "2026-07-14", "2026-10-11"],
  ] as const)("%s ends today (UTC) and starts the day count back", (preset, from, to) => {
    expect(presetRange(preset, NOON_2026_10_11)).toEqual({ from, to })
  })

  test("the window crosses a year boundary without a local-time shift", () => {
    expect(presetRange("week", Date.parse("2027-01-02T00:30:00Z"))).toEqual({ from: "2026-12-27", to: "2027-01-02" })
  })
})

describe("#142 TUI formats", () => {
  test.each([
    [0, "0"],
    [999, "999"],
    [1_000, "1k"],
    [1_300, "1.3k"],
    [45_600, "45.6k"],
    [450_000, "450k"],
    [1_000_000, "1M"],
    [3_400_000_000, "3.4B"],
  ])("formatCount(%d) is %s", (value, text) => {
    expect(formatCount(value)).toBe(text)
  })

  test.each([
    [0, "$0.00"],
    [0.004, "<$0.01"],
    [0.5, "$0.50"],
    [12.5, "$12.50"],
    [1_234, "$1.2k"],
  ])("formatCost(%d) is %s", (usd, text) => {
    expect(formatCost(usd)).toBe(text)
  })

  test("latency reads in ms below a second and in seconds above, and - without requests", () => {
    expect(formatMs(null)).toBe("-")
    expect(formatMs(250)).toBe("250 ms")
    expect(formatMs(2_500)).toBe("2.5 s")
    expect(formatMs(10_000)).toBe("10 s")
  })

  test("percent is - for zero lookups and rounds otherwise", () => {
    expect(formatPercent(0, 0)).toBe("-")
    expect(formatPercent(3, 4)).toBe("75%")
    expect(formatPercent(1, 3)).toBe("33%")
  })

  test("instants show UTC to the minute, - when absent", () => {
    expect(formatInstant(undefined)).toBe("-")
    expect(formatInstant("2026-10-11T09:30:15.000Z")).toBe("2026-10-11 09:30 UTC")
  })

  test("cells pad to width and cut long text with an ellipsis", () => {
    expect(cell("ab", 4, "left")).toBe("ab  ")
    expect(cell("ab", 4, "right")).toBe("  ab")
    expect(cell("abcdef", 4, "left")).toBe("abc…")
    expect(
      formatLine(
        ["x", "1"],
        [
          { title: "a", width: 3, align: "left" },
          { title: "b", width: 2, align: "right" },
        ],
      ),
    ).toBe("x    1")
  })

  test("bars scale to the share and show at least one block for any positive share", () => {
    expect(barCells(0, 10)).toBe("")
    expect(barCells(0.5, 10)).toBe("█".repeat(5))
    expect(barCells(0.001, 10)).toBe("█")
    expect(barCells(2, 10)).toBe("█".repeat(10))
  })
})

describe("#142 TUI rows and totals", () => {
  test("apps are sorted by cost, then requests, then name, with the cost share", () => {
    const rows = appRows(report)
    expect(rows.map((row) => row.app)).toEqual(["chat", "embed"])
    expect(rows[0]).toMatchObject({ app: "chat", requests: 8, tokens: 16_000, costUsd: 3.5, errors: 2, p95Ms: 2_500, share: 1 })
    expect(rows[0]?.lastRequestAt).toBe("2026-10-11T09:30:15.000Z")
    expect(rows[1]).toMatchObject({ app: "embed", requests: 4, tokens: 900, costUsd: 0, share: 0 })
    expect(rows[1]?.lastRequestAt).toBeUndefined()
  })

  test("an unpriced range shares by requests instead, so the bars still show traffic", () => {
    const free: UsageReport = { ...report, totals: totals({ requests: 8 }), apps: { embed: appReport(2, 0, {}), chat: appReport(6, 0, {}) } }
    expect(appRows(free).map((row) => row.share)).toEqual([0.75, 0.25])
  })

  test("app values are formatted for the table", () => {
    expect(appValues(appRows(report)[0]!)).toEqual(["chat", "8", "16k", "$3.50", "2", "2.5 s", "2026-10-11 09:30 UTC"])
    expect(formatLine(appValues(appRows(report)[0]!), APP_COLUMNS).length).toBe(APP_COLUMNS.reduce((sum, column) => sum + column.width, 0) + APP_COLUMNS.length - 1)
  })

  test("models are summed over the apps, most expensive first, and capped", () => {
    const rows = modelRows(report, 10)
    expect(rows.map((row) => row.model)).toEqual(["anthropic/sonnet", "openai/gpt", "openai/text-embed"])
    expect(rows[0]).toEqual({ model: "anthropic/sonnet", requests: 5, tokens: 12_000, costUsd: 3 })
    expect(modelRows(report, 1)).toHaveLength(1)
  })

  test("the totals line carries cache hit %, 429s and p95 in the page's order", () => {
    const items = totalItems(report.apps.chat!.totals)
    expect(items.map((item) => item.label)).toEqual(["requests", "tokens", "est. cost", "errors", "cache hit", "fallbacks", "429s", "p95"])
    expect(items.find((item) => item.label === "cache hit")?.value).toBe("75%")
    expect(items.find((item) => item.label === "p95")?.value).toBe("2.5 s")
    expect(items.find((item) => item.label === "errors")?.value).toBe("2")
  })

  test("an empty range has no rows and no latency", () => {
    const empty: UsageReport = { ...report, totals: totals(), apps: {} }
    expect(appRows(empty)).toEqual([])
    expect(modelRows(empty, 10)).toEqual([])
    expect(totalItems(empty.totals).find((item) => item.label === "p95")?.value).toBe("-")
    expect(totalItems(empty.totals).find((item) => item.label === "cache hit")?.value).toBe("-")
  })
})

describe("#142 TUI unavailable message", () => {
  test("names the cause and keeps the error text exact", () => {
    expect(unavailableMessage(new Error("rpc method not found"))).toBe("Usage is unavailable on this server. Plugboard must be loaded there with usage enabled. (rpc method not found)")
    expect(unavailableMessage("plain")).toContain("(plain)")
  })
})
