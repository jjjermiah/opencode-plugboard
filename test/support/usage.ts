/**
 * In-memory usage storage for the usage tests: a `StoragePort` with the host's scan semantics (keys
 * sorted, `after` exclusive, `next` set when more keys remain), and a clock the test moves by hand.
 */
import type { StoragePort } from "../../src/session/host.js"

export class FakeStorage implements StoragePort {
  readonly values = new Map<string, string>()
  /** Keys in the order they were written. */
  readonly puts: string[] = []
  readonly drops: string[] = []
  /** Make every `put` reject (a full disk, a locked database). */
  failPuts = false

  async get(key: string): Promise<string | undefined> {
    return this.values.get(key)
  }

  async put(key: string, value: string): Promise<void> {
    if (this.failPuts) throw new Error("storage unavailable")
    this.puts.push(key)
    this.values.set(key, value)
  }

  async drop(key: string): Promise<void> {
    this.drops.push(key)
    this.values.delete(key)
  }

  async scan(input: { readonly prefix: string; readonly after?: string; readonly limit: number }): Promise<{ readonly keys: ReadonlyArray<string>; readonly next?: string }> {
    const matching = [...this.values.keys()].filter((key) => key.startsWith(input.prefix) && (input.after === undefined || key > input.after)).sort()
    const keys = matching.slice(0, input.limit)
    return matching.length > input.limit ? { keys, next: keys.at(-1) } : { keys }
  }
}

/** A clock in epoch ms that only moves when the test says so. */
export function clock(start: string): { at: number } {
  return { at: Date.parse(start) }
}
