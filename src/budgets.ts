/**
 * Per-app budgets (option `budgets`): a `ModelCaller` wrapper that refuses a call with 429
 * `budget_exceeded` once its app has used a ceiling for the current window.
 *
 * Windows are UTC: a calendar day, an ISO week (Monday start) and a calendar month. The check reads
 * what the usage records already hold for the window (`UsageRecorder.spent`, src/usage.ts): requests
 * on the model routes that were not refused by a limit or a budget, the tokens of answered calls and
 * their cost at list prices. A call that crosses a ceiling is still served; the next one is refused.
 * Calls in flight are not counted until they end, so a burst can pass a ceiling by the calls it
 * admitted. A call that finds the records unreadable is refused with 503 `budget_unavailable` rather
 * than let through.
 *
 * The check runs before anything else is taken: a refused call holds no concurrency slot and spends
 * no requests-per-minute count. `index.ts` puts this wrapper outside `withLimits` for that reason.
 * Crossing 80% of a ceiling logs `budget.warning` once per app, budget and window (and again in the
 * next window). The warning state lives on the process runtime, so a plugin generation keeps it.
 */

import type { Budget, BudgetMetric, BudgetWindow, Budgets } from "./config.js"
import type { CallContext, ModelCaller, PlugError, PlugEvent, PlugRequest } from "./contract.js"
import { errorMessage, logError, logWarn } from "./log.js"
import { totalTokens, utcDate, type BudgetStatus, type DayRecord, type UsageRecorder } from "./usage.js"

/** What the warnings already logged: `app|metric|window` -> the window's first day. The process-wide state (src/runtime.ts). */
export interface BudgetState {
  readonly warned: Map<string, string>
}

export const createBudgetState = (): BudgetState => ({ warned: new Map() })

export interface BudgetOptions {
  /** Clock in epoch ms. Tests inject one; the default is `Date.now`. */
  readonly now?: () => number
  /** Called once for each refused call (metrics, usage). */
  readonly onRefused?: (app: string) => void
}

const DAY_MS = 86_400_000
const WARN_AT = 0.8
const METRICS: ReadonlyArray<BudgetMetric> = ["requests", "tokens", "costUsd"]
const WINDOWS: ReadonlyArray<BudgetWindow> = ["day", "week", "month"]
const LABEL: Record<BudgetMetric, string> = { requests: "requests", tokens: "tokens", costUsd: "cost (USD)" }

/** The window that holds `at`: its first UTC day (`start`) and the instant the next one begins (`resetsAt`, epoch ms). */
export function windowAt(window: BudgetWindow, at: number): { readonly start: string; readonly resetsAt: number } {
  const now = new Date(at)
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const today = Date.UTC(year, month, now.getUTCDate())
  if (window === "day") return { start: utcDate(today), resetsAt: today + DAY_MS }
  if (window === "week") {
    // getUTCDay counts from Sunday; Monday is 0 here.
    const monday = today - ((now.getUTCDay() + 6) % 7) * DAY_MS
    return { start: utcDate(monday), resetsAt: monday + 7 * DAY_MS }
  }
  return { start: utcDate(Date.UTC(year, month, 1)), resetsAt: Date.UTC(year, month + 1, 1) }
}

/** The budget that applies to `app`: `perApp`, with the app's `apps` entry replacing each metric it sets. Undefined when neither sets a metric. */
export function budgetFor(budgets: Budgets, app: string): Budget | undefined {
  const own = budgets.apps && Object.hasOwn(budgets.apps, app) ? budgets.apps[app] : undefined
  const merged: Budget = { ...budgets.perApp, ...own }
  return METRICS.some((metric) => merged[metric] !== undefined) ? merged : undefined
}

interface Ceiling {
  readonly metric: BudgetMetric
  readonly window: BudgetWindow
  readonly limit: number
}

/** Every ceiling the budget sets, in a fixed order: metric, then window. */
function ceilingsOf(budget: Budget): Ceiling[] {
  const out: Ceiling[] = []
  for (const metric of METRICS)
    for (const window of WINDOWS) {
      const limit = budget[metric]?.[window]
      if (limit !== undefined) out.push({ metric, window, limit })
    }
  return out
}

/** What a window's records count against a ceiling. Requests leave out refusals, which `limited` counts. */
function usedOf(day: DayRecord, metric: BudgetMetric): number {
  if (metric === "requests") return day.requests - day.limited
  if (metric === "tokens") return totalTokens(day.tokens)
  return day.costUsd
}

interface Spent {
  readonly day: DayRecord
  readonly resetsAt: number
  /** First UTC day of the window. */
  readonly start: string
}

/** The records of the window holding `at`, from its first day to today. Memoized per call, so each window is read once. */
function spentFor(usage: UsageRecorder, app: string, at: number): (window: BudgetWindow) => Promise<Spent> {
  const seen = new Map<BudgetWindow, Promise<Spent>>()
  return (window) => {
    let found = seen.get(window)
    if (!found) {
      const { start, resetsAt } = windowAt(window, at)
      seen.set(window, (found = usage.spent(app, start, utcDate(at)).then((day) => ({ day, resetsAt, start }))))
    }
    return found
  }
}

/** The state of every ceiling of `budget` for `app` now: what the current window has used, and when it resets. */
export async function budgetStatus(usage: UsageRecorder, budget: Budget, app: string, at: number): Promise<BudgetStatus[]> {
  const spent = spentFor(usage, app, at)
  const rows: BudgetStatus[] = []
  for (const { metric, window, limit } of ceilingsOf(budget)) {
    const current = await spent(window)
    rows.push({ metric, window, limit, used: usedOf(current.day, metric), resetsAt: new Date(current.resetsAt).toISOString() })
  }
  return rows
}

/** The refusal for a call now, or undefined. Logs the warnings the ceilings cross (once each per window). */
async function check(budget: Budget, app: string, usage: UsageRecorder, state: BudgetState, at: number): Promise<PlugError | undefined> {
  const spent = spentFor(usage, app, at)
  const exceeded: string[] = []
  let resetsAt = 0
  for (const { metric, window, limit } of ceilingsOf(budget)) {
    const current = await spent(window)
    const used = usedOf(current.day, metric)
    if (used >= limit * WARN_AT) warnOnce(state, app, metric, window, current.start, { used, limit, resetsAt: current.resetsAt })
    if (used >= limit) {
      exceeded.push(`${LABEL[metric]} ${window}`)
      resetsAt = Math.max(resetsAt, current.resetsAt)
    }
  }
  if (exceeded.length === 0) return undefined
  const retryAfterSeconds = Math.max(1, Math.ceil((resetsAt - at) / 1000))
  logWarn("request.budget_exceeded", { app, budgets: exceeded.join(", "), retryAfterSeconds })
  return { status: 429, kind: "rate_limit", code: "budget_exceeded", message: `Budget for ${app} exceeded: ${exceeded.join(", ")}`, retryAfterSeconds }
}

function warnOnce(
  state: BudgetState,
  app: string,
  metric: BudgetMetric,
  window: BudgetWindow,
  start: string,
  figures: { readonly used: number; readonly limit: number; readonly resetsAt: number },
): void {
  const key = `${app}|${metric}|${window}`
  if (state.warned.get(key) === start) return
  state.warned.set(key, start)
  logWarn("budget.warning", { app, budget: metric, window, used: figures.used, limit: figures.limit, resetsAt: new Date(figures.resetsAt).toISOString() })
}

/**
 * The budget caller: each call of an app with a budget is checked first. With no budget for the app,
 * no usage recorder, or no budgets at all, the caller is returned as it is. `budgets` is the parsed option.
 */
export function withBudgets(inner: ModelCaller, budgets: Budgets | undefined, usage: UsageRecorder | undefined, state: BudgetState, options: BudgetOptions = {}): ModelCaller {
  const now = options.now ?? Date.now
  return {
    stream(request, context) {
      const budget = budgets === undefined ? undefined : budgetFor(budgets, context.app)
      if (!usage || !budget) return inner.stream(request, context)
      return admit(inner, budget, usage, state, now, options.onRefused, request, context)
    },
  }
}

async function* admit(
  inner: ModelCaller,
  budget: Budget,
  usage: UsageRecorder,
  state: BudgetState,
  now: () => number,
  onRefused: BudgetOptions["onRefused"],
  request: PlugRequest,
  context: CallContext,
): AsyncGenerator<PlugEvent> {
  const app = context.app
  let refusal: PlugError | undefined
  try {
    refusal = await check(budget, app, usage, state, now())
  } catch (error) {
    logError("budget.check_failed", { app, error: errorMessage(error) })
    refusal = { status: 503, kind: "server", code: "budget_unavailable", message: "Could not read the usage records for the budget check" }
  }
  if (refusal) {
    if (refusal.status === 429) onRefused?.(app)
    yield { type: "error", error: refusal }
    return
  }
  for await (const event of inner.stream(request, context)) yield event
}
