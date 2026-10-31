/**
 * Where the exchange records live (`src/record.ts`): plugboard's own key-value storage on the host (`ctx.storage`), one string per record,
 * keyed by app, so one app's key can only ever read its own records (the app is part of the key, never of the lookup input):
 *
 *   record/<app>/<request id>               the record, as JSON text
 *   record-session/<app>/<session id>       the request id of the record that made the session (a lookup by session id)
 *
 * Records are never pruned: the session sweep does not touch them, and `sessions.maxAgeDays` does not apply.
 */

import type { StoragePort } from "./session/host.js"

export interface RecordStore {
  /** Writes the record, and a pointer for each session it made. A failure rejects. */
  save(app: string, id: string, sessions: ReadonlyArray<string>, json: string): Promise<void>
  /** The record JSON of `app` named by a request id or a session id, or undefined. Another app's record is undefined. */
  load(app: string, key: string): Promise<string | undefined>
}

const KEY = /^[\w.:-]{1,128}$/

export interface RecordStoreDeps {
  readonly storage: StoragePort
}

export function createRecordStore({ storage }: RecordStoreDeps): RecordStore {
  const recordKey = (app: string, id: string) => `record/${app}/${id}`
  const pointerKey = (app: string, session: string) => `record-session/${app}/${session}`
  return {
    async save(app, id, sessions, json) {
      await storage.put(recordKey(app, id), json)
      for (const session of sessions) await storage.put(pointerKey(app, session), id)
    },
    async load(app, key) {
      if (!KEY.test(key)) return undefined
      const direct = await storage.get(recordKey(app, key))
      if (direct !== undefined) return direct
      const id = await storage.get(pointerKey(app, key))
      return id === undefined ? undefined : storage.get(recordKey(app, id))
    },
  }
}
