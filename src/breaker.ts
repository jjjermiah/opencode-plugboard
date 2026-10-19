/**
 * The circuit breaker of fallback chains (option `fallbackCooldown`, `src/fallback.ts`): pure state, no I/O, no timers.
 *
 * Each target model (`provider/model[#variant]`) has its own breaker. `failureThreshold` failures in a row, all within
 * `windowMs` of the first, open it: the target is skipped for `cooldownMs`. When that has passed the breaker is half
 * open: one request (the probe) is let through; its answer closes the breaker, its failure opens it again. The state
 * lives on the process runtime (`src/runtime.ts`), so it holds across plugin generations. Time is read from the clock
 * given to `createBreaker`, which a test replaces.
 *
 * Every method takes the resolved option (`FallbackCooldown`), so a breaker keeps no configuration of its own.
 */

import type { FallbackCooldown } from "./config.js"

/** What `claim` says about an attempt: run it (`allow`, or `probe` for the one half-open request), or skip the target. */
export type Verdict = "allow" | "probe" | "skip"

/** A target that is cooling down, for `GET /plugboard/status`. `until` is when its cooldown ends (epoch ms). */
export interface CoolingTarget {
  readonly model: string
  /** `open`: skipped until `until`. `half-open`: `until` has passed and the next request is the probe. */
  readonly state: "open" | "half-open"
  readonly failures: number
  readonly until: number
}

interface Entry {
  failures: number
  /** When the current streak of failures began. */
  since: number
  /** Set while the breaker is open or half open: the end of the cooldown. */
  openUntil?: number
  /** When the half-open probe was handed out and not yet answered. */
  probeAt?: number
}

export interface Breaker {
  /** Whether an attempt on `model` would run now. Takes nothing: use it to look ahead. */
  peek(model: string, config: FallbackCooldown): boolean
  /** Decides an attempt on `model`; `probe` takes the half-open slot, which the attempt must give back with `success`, `failure` or `release`. */
  claim(model: string, config: FallbackCooldown): Verdict
  /** The attempt answered: a streak ends, an open breaker closes (`closed`). */
  success(model: string): "closed" | undefined
  /** The attempt failed with a retryable failure: `opened` when this one reached the threshold, `reopened` when an open or half-open target failed again. */
  failure(model: string, config: FallbackCooldown): "opened" | "reopened" | undefined
  /** The attempt ended with no verdict on the target (the client left, or a client error): gives the probe slot back. */
  release(model: string): void
  /** The targets whose breaker is open or half open. */
  cooling(): CoolingTarget[]
  /** The end of the cooldown of `model` while it is open; undefined when it is not cooling down. */
  until(model: string): number | undefined
}

export function createBreaker(now: () => number = Date.now): Breaker {
  const entries = new Map<string, Entry>()

  // A probe that never reported (its request was lost) does not block the target forever: after a cooldown it is handed out again.
  const verdict = (entry: Entry | undefined, config: FallbackCooldown): Verdict => {
    if (entry?.openUntil === undefined) return "allow"
    const at = now()
    if (at < entry.openUntil) return "skip"
    return entry.probeAt !== undefined && at - entry.probeAt < config.cooldownMs ? "skip" : "probe"
  }

  return {
    peek: (model, config) => verdict(entries.get(model), config) !== "skip",
    claim(model, config) {
      const entry = entries.get(model)
      const result = verdict(entry, config)
      if (result === "probe") entry!.probeAt = now()
      return result
    },
    success(model) {
      const entry = entries.get(model)
      if (!entry) return undefined
      entries.delete(model)
      return entry.openUntil === undefined ? undefined : "closed"
    },
    failure(model, config) {
      const at = now()
      let entry = entries.get(model)
      if (entry?.openUntil !== undefined) {
        entry.openUntil = at + config.cooldownMs
        entry.probeAt = undefined
        entry.failures++
        return "reopened"
      }
      // A streak slower than the window starts over.
      if (!entry || at - entry.since > config.windowMs) entries.set(model, (entry = { failures: 0, since: at }))
      entry.failures++
      if (entry.failures < config.failureThreshold) return undefined
      entry.openUntil = at + config.cooldownMs
      return "opened"
    },
    release(model) {
      const entry = entries.get(model)
      if (entry) entry.probeAt = undefined
    },
    cooling() {
      const at = now()
      return [...entries]
        .filter(([, entry]) => entry.openUntil !== undefined)
        .map(([model, entry]) => ({ model, state: at < entry.openUntil! ? ("open" as const) : ("half-open" as const), failures: entry.failures, until: entry.openUntil! }))
    },
    until: (model) => entries.get(model)?.openUntil,
  }
}
