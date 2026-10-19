/**
 * Pure helpers for the `/plugboard` usage page (src/tui.tsx): the range presets, the rows and totals
 * of a `UsageReport`, and the number formats. No OpenTUI, Solid or server imports, so `bun test`
 * covers them directly. Types only from src/usage.ts (its runtime pulls in the server's logger).
 */

import type { UsageErrors, UsageReport, UsageTokens, UsageTotals } from "./usage.js"

export type RangePreset = "today" | "week" | "month" | "quarter"

/** The page's range keys, in the order the header lists them. `days` counts the UTC days ending today. */
export const RANGE_PRESETS: ReadonlyArray<{ readonly key: string; readonly preset: RangePreset; readonly label: string; readonly days: number }> = [
  { key: "t", preset: "today", label: "today", days: 1 },
  { key: "w", preset: "week", label: "7 days", days: 7 },
  { key: "m", preset: "month", label: "30 days", days: 30 },
  { key: "q", preset: "quarter", label: "90 days", days: 90 },
]

const DAY_MS = 86_400_000

/** The UTC calendar day of an epoch-ms instant, `YYYY-MM-DD`. */
export function utcDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10)
}

/** The inclusive UTC range of a preset ending today, the same window the server's default uses. */
export function presetRange(preset: RangePreset, at: number): { readonly from: string; readonly to: string } {
  const days = RANGE_PRESETS.find((item) => item.preset === preset)?.days ?? 30
  const to = utcDay(at)
  return { from: utcDay(Date.parse(`${to}T00:00:00Z`) - (days - 1) * DAY_MS), to }
}

/** Counts in thousands and millions: 999, 1.2k, 45k, 3.4M. Inputs are whole numbers. */
export function formatCount(value: number): string {
  for (const [size, suffix] of [
    [1_000_000_000, "B"],
    [1_000_000, "M"],
    [1_000, "k"],
  ] as const) {
    if (value >= size) return `${trimmed(value / size)}${suffix}`
  }
  return String(value)
}

function trimmed(value: number): string {
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "")
}

/** USD: `$0.00`, `<$0.01` for a cost below a cent, `$12.34`, and `$1.2k` from a thousand up. */
export function formatCost(usd: number): string {
  if (usd === 0) return "$0.00"
  if (usd < 0.01) return "<$0.01"
  if (usd < 1_000) return `$${usd.toFixed(2)}`
  return `$${formatCount(usd)}`
}

/** A latency in ms, or `-` without requests. The percentiles are bucket bounds, so they read as estimates. */
export function formatMs(ms: number | null): string {
  if (ms === null) return "-"
  if (ms < 1_000) return `${ms} ms`
  return `${Number((ms / 1_000).toFixed(1))} s`
}

/** `part` of `whole` as a whole percent, or `-` when `whole` is zero. */
export function formatPercent(part: number, whole: number): string {
  return whole === 0 ? "-" : `${Math.round((part / whole) * 100)}%`
}

/** An ISO instant as `2026-10-11 14:02 UTC`, or `-` when absent. */
export function formatInstant(iso: string | undefined): string {
  return iso === undefined ? "-" : `${iso.slice(0, 16).replace("T", " ")} UTC`
}

/** A text cell of exactly `width` columns; longer text is cut with an ellipsis. */
export function cell(text: string, width: number, align: "left" | "right"): string {
  const clipped = text.length > width ? `${text.slice(0, width - 1)}…` : text
  return align === "right" ? clipped.padStart(width) : clipped.padEnd(width)
}

export interface Column {
  readonly title: string
  readonly width: number
  readonly align: "left" | "right"
}

export const APP_COLUMNS: ReadonlyArray<Column> = [
  { title: "app", width: 18, align: "left" },
  { title: "requests", width: 9, align: "right" },
  { title: "tokens", width: 8, align: "right" },
  { title: "cost", width: 9, align: "right" },
  { title: "errors", width: 7, align: "right" },
  { title: "p95", width: 8, align: "right" },
  { title: "last request", width: 17, align: "left" },
]

export const MODEL_COLUMNS: ReadonlyArray<Column> = [
  { title: "model", width: 36, align: "left" },
  { title: "requests", width: 9, align: "right" },
  { title: "tokens", width: 8, align: "right" },
  { title: "cost", width: 9, align: "right" },
]

/** One line of a table: each value in its column, separated by one space. */
export function formatLine(values: ReadonlyArray<string>, columns: ReadonlyArray<Column>): string {
  return columns.map((column, index) => cell(values[index] ?? "", column.width, column.align)).join(" ")
}

/** A bar of up to `width` blocks for a share in 0..1; any positive share shows at least one block. */
export function barCells(share: number, width: number): string {
  if (!(share > 0)) return ""
  return "█".repeat(Math.min(width, Math.max(1, Math.round(share * width))))
}

export function tokenTotal(tokens: UsageTokens): number {
  return tokens.input + tokens.cacheRead + tokens.cacheWrite + tokens.output + tokens.reasoning
}

export function errorTotal(errors: UsageErrors): number {
  return errors.client + errors.server + errors.timeout + errors.disconnected
}

export interface AppRow {
  readonly app: string
  readonly requests: number
  readonly tokens: number
  readonly costUsd: number
  readonly errors: number
  readonly p95Ms: number | null
  readonly lastRequestAt?: string
  /** Share of the range's cost, or of its requests when nothing was priced: 0..1, for the bar. */
  readonly share: number
}

/** One row per app, most expensive first (then most requests, then name). */
export function appRows(report: UsageReport): AppRow[] {
  const { totals } = report
  return Object.entries(report.apps)
    .map(([app, entry]): AppRow => {
      const share = totals.costUsd > 0 ? entry.totals.costUsd / totals.costUsd : totals.requests > 0 ? entry.totals.requests / totals.requests : 0
      return {
        app,
        requests: entry.totals.requests,
        tokens: tokenTotal(entry.totals.tokens),
        costUsd: entry.totals.costUsd,
        errors: errorTotal(entry.totals.errors),
        p95Ms: entry.totals.latency.p95Ms,
        ...(entry.totals.lastRequestAt === undefined ? {} : { lastRequestAt: entry.totals.lastRequestAt }),
        share,
      }
    })
    .sort((a, b) => b.costUsd - a.costUsd || b.requests - a.requests || a.app.localeCompare(b.app))
}

export function appValues(row: AppRow): string[] {
  return [row.app, formatCount(row.requests), formatCount(row.tokens), formatCost(row.costUsd), formatCount(row.errors), formatMs(row.p95Ms), formatInstant(row.lastRequestAt)]
}

export interface ModelRow {
  readonly model: string
  readonly requests: number
  readonly tokens: number
  readonly costUsd: number
}

/** The models of every app, summed over the range: most expensive first, at most `limit`. */
export function modelRows(report: UsageReport, limit: number): ModelRow[] {
  const sums = new Map<string, { requests: number; tokens: number; costUsd: number }>()
  for (const app of Object.values(report.apps)) {
    for (const [model, usage] of Object.entries(app.models)) {
      const sum = sums.get(model) ?? { requests: 0, tokens: 0, costUsd: 0 }
      sums.set(model, { requests: sum.requests + usage.requests, tokens: sum.tokens + usage.tokens, costUsd: sum.costUsd + usage.costUsd })
    }
  }
  return [...sums]
    .map(([model, sum]): ModelRow => ({ model, ...sum }))
    .sort((a, b) => b.costUsd - a.costUsd || b.requests - a.requests || a.model.localeCompare(b.model))
    .slice(0, limit)
}

export function modelValues(row: ModelRow): string[] {
  return [row.model, formatCount(row.requests), formatCount(row.tokens), formatCost(row.costUsd)]
}

export interface TotalItem {
  readonly label: string
  readonly value: string
}

/** The totals line, in the order the page shows it. */
export function totalItems(totals: UsageTotals): TotalItem[] {
  const lookups = totals.cacheHits + totals.cacheMisses
  return [
    { label: "requests", value: formatCount(totals.requests) },
    { label: "tokens", value: formatCount(tokenTotal(totals.tokens)) },
    { label: "est. cost", value: formatCost(totals.costUsd) },
    { label: "errors", value: formatCount(errorTotal(totals.errors)) },
    { label: "cache hit", value: formatPercent(totals.cacheHits, lookups) },
    { label: "fallbacks", value: formatCount(totals.fallbacks) },
    { label: "429s", value: formatCount(totals.limited) },
    { label: "p95", value: formatMs(totals.latency.p95Ms) },
  ]
}

/** The message the page shows when the usage RPC cannot answer (plugboard not loaded there, or usage off). */
export function unavailableMessage(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error)
  return `Usage is unavailable on this server. Plugboard must be loaded there with usage enabled. (${reason})`
}
