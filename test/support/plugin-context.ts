/**
 * A spy plugin context for the freeze-safety tests: a stand-in for OpenCode's `Plugin.Context`
 * that records every method called on any domain (`session.hook`, `agent.list`, `storage.scan`,
 * ...) in order. Tests mark phases (`setup`, `finalizer`, a request) and assert which calls each
 * phase made; freeze safety is mostly "setup made only these calls, the finalizer made none".
 *
 * Every domain method returns `Effect.void` unless `respond` gives it an answer. What setup
 * registers (the context hook, agent and tool transforms) is kept so a test can run it later.
 */
import type { Plugin } from "@opencode/plugin/effect"
import { Effect } from "effect"

export interface SpyCall {
  /** `domain.method`, e.g. `session.hook`. */
  readonly path: string
  readonly args: ReadonlyArray<unknown>
  /** The phase that was current when the call happened (`mark`). */
  readonly phase: string
}

export interface SpyContext {
  readonly ctx: Plugin.Context
  readonly calls: SpyCall[]
  /** Paths called during `phase`. */
  during(phase: string): string[]
  /** Sets the phase later calls are recorded under. */
  mark(phase: string): void
  /** The callback passed to the first call of `path` (e.g. `session.hook` -> the context hook). */
  registered<T = (...args: never[]) => unknown>(path: string): T
}

export interface SpyContextInput {
  /** `ctx.options`: the raw plugin options. */
  readonly options?: unknown
  /** `ctx.location.directory`. */
  readonly directory: string
  /** `ctx.app`: the host's name, version and channel. Absent: `ctx.app` is undefined, as in a host that passes none. */
  readonly app?: { readonly name: string; readonly version: string; readonly channel: string }
  /** Answers for specific methods, by `domain.method`. */
  readonly respond?: Readonly<Record<string, (...args: never[]) => unknown>>
}

export function spyContext(input: SpyContextInput): SpyContext {
  const calls: SpyCall[] = []
  let phase = "setup"
  const domain = (name: string) =>
    new Proxy(
      {},
      {
        get: (_target, method) => {
          if (typeof method !== "string") return undefined
          const path = `${name}.${method}`
          return (...args: unknown[]) => {
            calls.push({ path, args, phase })
            const answer = input.respond?.[path]
            return answer ? (answer as (...args: unknown[]) => unknown)(...args) : Effect.void
          }
        },
      },
    )
  const data: Record<string, unknown> = { options: input.options, location: { directory: input.directory }, app: input.app }
  const ctx = new Proxy(data, { get: (target, key) => (typeof key !== "string" ? undefined : key in target ? target[key] : (target[key] = domain(key))) })
  return {
    // The spy covers the whole domain surface by construction; the one cast is here.
    ctx: ctx as unknown as Plugin.Context,
    calls,
    during: (name) => calls.filter((call) => call.phase === name).map((call) => call.path),
    mark: (name) => void (phase = name),
    registered: <T>(path: string) => {
      const call = calls.find((entry) => entry.path === path)
      if (!call) throw new Error(`${path} was never called`)
      return call.args.find((arg) => typeof arg === "function") as T
    },
  }
}
