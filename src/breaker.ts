/**
 * The circuit breaker of fallback chains (option `circuitBreaker`, `src/fallback.ts`): pure state, no I/O, no timers.
 *
 * Each target model (`provider/model[#variant]`, so a variant has its own breaker) has its own breaker. `failures`
 * failures in a row, all within `failureWindowMs` of the first, open it: the target is skipped for `cooldownMs`. When that has
 * passed the breaker is half open: one request (the probe) is let through; its answer closes the breaker, its failure opens
 * it again. A probe is identified by the token `claim` hands out, so only the attempt that holds the slot can give it back. A breaker that nobody has used for `cooldownMs + failureWindowMs` after its cooldown is
 * forgotten. The state lives on the process runtime (`src/runtime.ts`), so it holds across plugin generations. Time is read
 * from the clock given to `createBreaker`, which a test replaces.
 *
 * Every method that decides takes the resolved option (`CircuitBreaker`), so a breaker keeps no configuration of its own.
 */

import type { CircuitBreaker } from "./config.js"

/** What `claim` says about an attempt: run it (`allow`, or `probe` for the one half-open request), or skip the target. */
export type Verdict = "allow" | "probe" | "skip"

/** The answer of `claim`. `token` is set for a `probe`: hand it back to `release`. */
export interface Claim {
  readonly verdict: Verdict
  readonly token?: number
}

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
  /** After this the entry is forgotten (unless a probe is out): `openUntil + cooldownMs + failureWindowMs`. */
  staleAt?: number
  /** The half-open probe that was handed out and not yet answered: who holds it, and since when. */
  probe?: { readonly token: number; readonly at: number }
}

export interface Breaker {
  /** Whether an attempt on `model` would run now. Takes nothing: use it to look ahead. */
  peek(model: string, config: CircuitBreaker): boolean
  /** Decides an attempt on `model`; a `probe` takes the half-open slot, which its attempt must settle through `success`, `failure` or `release` (with the token). */
  claim(model: string, config: CircuitBreaker): Claim
  /** The attempt answered: a streak ends, an open breaker closes (`closed`), whoever held the probe. */
  success(model: string): "closed" | undefined
  /**
   * The attempt failed in a way that counts against the target. `opened` when this failure reached the threshold. `reopened` when the
   * breaker was half open (the probe's, or that of an attempt forced through): the cooldown starts over, and the probe slot with it. A
   * failure on a breaker that is still open (an attempt that began before it opened) counts quietly and extends nothing.
   */
  failure(model: string, config: CircuitBreaker): "opened" | "reopened" | undefined
  /** The attempt ended with no verdict on the target (the client left, a failure that is not the target's): gives the probe slot back, only if `token` holds it. */
  release(model: string, token?: number): void
  /** The targets whose breaker is open or half open. */
  cooling(): CoolingTarget[]
  /** The end of the cooldown of `model` while it is open; undefined when it is not cooling down. */
  until(model: string): number | undefined
}

export function createBreaker(now: () => number = Date.now): Breaker {
  const entries = new Map<string, Entry>()
  let tokens = 0

  /** The entry of `model`, or undefined when there is none or it has been forgotten. */
  const live = (model: string): Entry | undefined => {
    const entry = entries.get(model)
    if (entry?.staleAt !== undefined && entry.probe === undefined && now() >= entry.staleAt) {
      entries.delete(model)
      return undefined
    }
    return entry
  }

  // A probe that never reported (its request was lost) does not block the target forever: after a cooldown it is handed out again.
  const verdict = (entry: Entry | undefined, config: CircuitBreaker): Verdict => {
    if (entry?.openUntil === undefined) return "allow"
    const at = now()
    if (at < entry.openUntil) return "skip"
    return entry.probe !== undefined && at - entry.probe.at < config.cooldownMs ? "skip" : "probe"
  }

  const open = (entry: Entry, config: CircuitBreaker): void => {
    entry.openUntil = now() + config.cooldownMs
    entry.staleAt = entry.openUntil + config.cooldownMs + config.failureWindowMs
  }

  return {
    peek: (model, config) => verdict(live(model), config) !== "skip",
    claim(model, config) {
      const entry = live(model)
      const result = verdict(entry, config)
      if (result !== "probe") return { verdict: result }
      const token = ++tokens
      entry!.probe = { token, at: now() }
      return { verdict: "probe", token }
    },
    success(model) {
      const entry = entries.get(model)
      if (!entry) return undefined
      entries.delete(model)
      return entry.openUntil === undefined ? undefined : "closed"
    },
    failure(model, config) {
      const at = now()
      let entry = live(model)
      if (entry?.openUntil !== undefined) {
        entry.failures++
        if (at < entry.openUntil) return undefined
        open(entry, config)
        entry.probe = undefined
        return "reopened"
      }
      // A streak slower than the window starts over.
      if (!entry || at - entry.since > config.failureWindowMs) entries.set(model, (entry = { failures: 0, since: at }))
      entry.failures++
      if (entry.failures < config.failures) return undefined
      open(entry, config)
      return "opened"
    },
    release(model, token) {
      const entry = entries.get(model)
      if (entry && token !== undefined && entry.probe?.token === token) entry.probe = undefined
    },
    cooling() {
      const at = now()
      return [...entries.keys()].flatMap((model) => {
        const entry = live(model)
        if (entry?.openUntil === undefined) return []
        return [{ model, state: at < entry.openUntil ? ("open" as const) : ("half-open" as const), failures: entry.failures, until: entry.openUntil }]
      })
    },
    until: (model) => live(model)?.openUntil,
  }
}
