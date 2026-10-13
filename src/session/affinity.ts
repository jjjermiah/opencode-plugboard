/**
 * Provider prompt-cache affinity (option `promptCache`, issue #80).
 *
 * OpenCode keys the provider prompt cache on a session's affinity: its parent session id when it has one, else its own
 * id (upstream `packages/core/src/session/affinity.ts`). Every plugboard request used to be a fresh top-level session, so
 * the key changed on every request and the provider had no prefix cache to hit.
 *
 * Mode `anchor` (the only mode): each request session is a child of one long-lived anchor session per scope key. The
 * anchor is created once, is never prompted, and is not indexed for pruning, so the affinity (and the key sent to the
 * provider, and the routing headers that follow it) stays the same across requests. The scope key is `app` (one anchor
 * per app) or the caller's `user` (one per end user). A request without a user under scope `user` gets no affinity.
 *
 * Measured live on 2026-10-12 (numbers in docs/configuration.md#prompt-cache-affinity): ChatGPT subscription models hit
 * the cache on 8 of 9 repeat runs with an anchor and 2 of 9 without one. A session-sharing mode was measured too (4 of
 * 9, no clear gain) and dropped.
 *
 * The anchor id is stored in the plugin's host storage (`affinity/...`), so it survives a restart.
 *
 * Option `history.hidden` (since 0.29.0, #337) reuses this store: the app-scope record (`affinity/<app>/anchor/app/`) is the
 * app's parent, which OpenCode's top-level lists do not show, so its request sessions are hidden with it. Same recovery.
 */

import { DEFAULT_MAX_ANCHORS, type AffinityScope, type PromptCache } from "../config.js"
import type { StoragePort } from "./host.js"

/**
 * Response header naming the affinity of a request under `promptCache` affinity `anchor`: `anchor` when the request
 * session is a child of its key's anchor, `none` when it got no affinity (no key, or the app is at `maxAnchors`).
 * Absent when the policy is `off`.
 */
export const AFFINITY_HEADER = "x-plugboard-affinity"

export const PROMPT_CACHE_OFF: PromptCache = { affinity: "off", scope: "app" }

/** The most anchors one app may hold under this policy. */
export const maxAnchorsOf = (cache: PromptCache): number => cache.maxAnchors ?? DEFAULT_MAX_ANCHORS

/** The scope key of one request, or undefined when it has none (then no affinity applies to that request). */
export function scopeKey(cache: PromptCache, call: { readonly user?: string }): string | undefined {
  return cache.scope === "app" ? "" : call.user
}

/** Sets `x-plugboard-affinity` before the first event (the headers are still open). */
export function reportAffinity(response: { setHeader(name: string, value: string): unknown; headersSent: boolean; destroyed: boolean }) {
  return (mode: "anchor" | "none") => {
    if (response.headersSent || response.destroyed) return
    response.setHeader(AFFINITY_HEADER, mode)
  }
}

export interface AffinityDeps {
  readonly storage: StoragePort
}

export interface Affinity {
  /**
   * The anchor session of one scope key: remembered once created, and concurrent first requests share one creation.
   * Resolves undefined when the app already holds `maxAnchors` anchors and this key has none: the request gets no affinity.
   */
  anchor(app: string, scope: AffinityScope, key: string, maxAnchors: number, make: () => Promise<string>): Promise<string | undefined>
  /** Drops the stored anchor of a key (its session was deleted in OpenCode). The next `anchor` call makes a new one. */
  forget(app: string, scope: AffinityScope, key: string): Promise<void>
}

const recordKey = (app: string, scope: AffinityScope, key: string): string => `affinity/${app}/anchor/${scope}/${key}`

/** Stored anchor records are `{ "sessionID": "ses_..." }`; anything else is no record and a new anchor is made. */
async function readAnchor(storage: StoragePort, key: string): Promise<string | undefined> {
  const raw = await storage.get(key)
  if (raw === undefined) return undefined
  try {
    const value = JSON.parse(raw) as { sessionID?: unknown } | null
    if (typeof value?.sessionID === "string") return value.sessionID
  } catch {
    // An unreadable record is treated as absent.
  }
  return undefined
}

export function createAffinity(deps: AffinityDeps): Affinity {
  const { storage } = deps
  // Anchor creations in flight, by record key: concurrent first requests on one key share one anchor.
  const pending = new Map<string, Promise<string | undefined>>()

  return {
    async forget(app, scope, key) {
      await storage.drop(recordKey(app, scope, key))
    },

    async anchor(app, scope, key, maxAnchors, make) {
      const id = recordKey(app, scope, key)
      const known = await readAnchor(storage, id)
      if (known !== undefined) return known
      let creating = pending.get(id)
      if (!creating) {
        creating = (async () => {
          // The cap counts the stored anchors of the app, every scope. Concurrent first requests may pass it together.
          const stored = await storage.scan({ prefix: `affinity/${app}/anchor/`, limit: maxAnchors })
          if (stored.keys.length >= maxAnchors) return undefined
          const sessionID = await make()
          await storage.put(id, JSON.stringify({ sessionID }))
          return sessionID
        })()
        pending.set(id, creating)
        const clear = () => {
          pending.delete(id)
        }
        creating.then(clear, clear)
      }
      return creating
    },
  }
}
