/**
 * Small builders for the neutral vocabulary: options, catalog models, `PlugEvent`s and
 * `PlugRequest`s. Every layer's tests start here so a fixture reads the same everywhere.
 */
import { parseOptions, type PlugboardOptions } from "../../src/config.js"
import type { CatalogModel, PlugError, PlugEvent, PlugFinish, PlugRequest, PlugUsage } from "../../src/contract.js"

/** Parsed options with test defaults: every `test/*` model allowed, no keys (keyless loopback). */
export function testOptions(raw: Record<string, unknown> = {}): PlugboardOptions {
  return parseOptions({ models: ["test/*"], ...raw })
}

/** One catalog model. */
export const model = (providerID: string, id: string, extra: Partial<CatalogModel> = {}): CatalogModel => ({
  providerID,
  id,
  variants: [],
  ...extra,
})

/** The catalog most tests use: `test/echo` (variants low and high), `test/vision`, `other/model`. */
export const CATALOG: ReadonlyArray<CatalogModel> = [
  model("test", "echo", { name: "Echo", variants: ["low", "high"], capabilities: { tools: true }, contextLimit: 8192 }),
  model("test", "vision", { capabilities: { tools: true, image: true } }),
  model("other", "model"),
]

/** `PlugEvent` builders, named after what the model did. */
export const ev = {
  text: (text: string): PlugEvent => ({ type: "text-delta", text }),
  reasoning: (text: string): PlugEvent => ({ type: "reasoning-delta", text }),
  call: (id: string, name: string, input: unknown = {}): PlugEvent => ({ type: "tool-call", id, name, input }),
  finish: (reason: PlugFinish = "stop", usage?: PlugUsage): PlugEvent => ({ type: "finish", reason, ...(usage ? { usage } : {}) }),
  error: (error: Partial<PlugError> = {}): PlugEvent => ({
    type: "error",
    error: { status: 502, kind: "server", message: "upstream failed", ...error },
  }),
}

/** A finite event stream. */
export async function* events(...list: PlugEvent[]): AsyncGenerator<PlugEvent> {
  for (const event of list) yield event
}

/** Drain an async iterable into an array. */
export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of iterable) out.push(item)
  return out
}

/** A resolved `PlugRequest` (one user message, no tools) with overrides. */
export const plugRequest = (overrides: Partial<PlugRequest> = {}): PlugRequest => ({
  model: "test/echo",
  ref: { providerID: "test", id: "echo" },
  system: [],
  messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
  tools: [],
  generation: {},
  ...overrides,
})

/** A promise you resolve from outside: holds a fake at a known point until the test lets it go. */
export interface Gate<T = void> {
  readonly promise: Promise<T>
  open(value: T): void
  readonly opened: boolean
}

export function gate<T = void>(): Gate<T> {
  let open!: (value: T) => void
  let opened = false
  const promise = new Promise<T>((resolve) => (open = resolve))
  return {
    promise,
    open: (value: T) => {
      opened = true
      open(value)
    },
    get opened() {
      return opened
    },
  }
}

/** Resolves on the next macrotask (lets sockets and promise chains settle without a real sleep). */
export const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

/** Polls `check` (sync or async) every millisecond until it is truthy, failing after `ms` (default 1 s). For socket-driven state only. */
export async function until(check: () => unknown, ms = 1_000, what = "condition"): Promise<void> {
  const end = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`Timed out after ${ms} ms waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}
