/**
 * The session-backed `ModelCaller`: one model call = one kept OpenCode session in the caller
 * app's directory under the data root, one model step.
 *
 * Lifecycle of `stream()`: validate the app name, prepare images, create the session, register
 * its request state, start the prompt, then relay the collector's events until it is terminal.
 * `finally` releases the store entry and interrupts anything still running. Request
 * sessions are registered in the process-wide session store (`state.ts`) so the app-directory
 * hook (`context.ts`) and the event pump can find them.
 */

import { randomUUID } from "node:crypto"
import { APP_NAME_PATTERN, DEFAULT_APP } from "../config.js"
import type { CallContext, ModelCaller, PlugEvent, PlugRequest } from "../contract.js"
import { RequestCollector } from "./events.js"
import { ensureAppDir, makeTitle, renderTranscript } from "./history.js"
import { describeError, type SessionPort } from "./host.js"
import { ImageError, prepareImages } from "./media.js"
import { SEED_PREFIX } from "./seeds.js"
import type { SessionStore } from "./state.js"

export interface SessionCallerDeps {
  readonly port: SessionPort
  /** The process-wide store request sessions are registered in. */
  readonly sessions: SessionStore
  /** Allow fetching http(s) image URLs (option `remoteImages`). */
  readonly remoteImages?: boolean
}

const failure = (status: number, message: string, code: string): PlugEvent => ({
  type: "error",
  error: { status, kind: status >= 500 ? "server" : "invalid_request", message, code },
})

export function createSessionCaller(deps: SessionCallerDeps): ModelCaller {
  const { port, sessions } = deps
  const remoteImages = deps.remoteImages === true

  return {
    async *stream(request: PlugRequest, context: CallContext): AsyncGenerator<PlugEvent> {
      const app = APP_NAME_PATTERN.test(context.app) || context.app === DEFAULT_APP ? context.app : undefined
      if (!app) return yield failure(400, `Invalid app name: ${context.app}`, "invalid_app")
      if (context.signal.aborted) return

      const requestID = randomUUID()
      let sessionID: string | undefined
      let collector: RequestCollector | undefined
      const interrupt = () => {
        if (sessionID)
          void port.interrupt(sessionID).catch((error) => console.error(`[opencode-plugboard] interrupt of ${sessionID} failed: ${describeError(error)}`))
      }
      const onAbort = () => {
        collector?.cancel()
        interrupt()
      }

      try {
        // 1. Prompt files: images become data URLs (http(s) ones are fetched once).
        const images = await prepareImages(request, context.signal, remoteImages)

        // 2. The app directory under the data root; one top-level session per request.
        const directory = await ensureAppDir(app)

        collector = new RequestCollector({ stopTurn: interrupt })
        const created = await port.create({
          directory,
          model: { providerID: request.ref.providerID, id: request.ref.id, ...(request.ref.variant ? { variant: request.ref.variant } : {}) },
          title: makeTitle(request),
          metadata: { plugboard: { app, model: request.model, requestID } },
          permissions: [{ action: `${SEED_PREFIX}*`, resource: "*", effect: "allow" }],
        })
        sessionID = String(created.id)
        sessions.register({ sessionID, app, requestID, request, collector })

        context.signal.addEventListener("abort", onAbort, { once: true })
        if (context.signal.aborted) return onAbort()

        // 3. Prompt concurrently; events stream through the collector while it runs.
        const owned = collector
        void port
          .prompt({ sessionID, text: renderTranscript(request), files: images })
          .catch((error) => {
            if (owned.terminal) return
            owned.push({ type: "session.execution.failed", error: { type: "prompt_failed", message: describeError(error) } })
          })

        for await (const event of collector.events()) yield event
      } catch (error) {
        if (error instanceof ImageError) yield failure(400, error.message, error.code)
        else if (!context.signal.aborted) yield failure(502, `plugboard session backend failed: ${describeError(error)}`, "backend_failed")
      } finally {
        context.signal.removeEventListener("abort", onAbort)
        if (sessionID) {
          sessions.release(sessionID)
          // Anything still running (consumer left early, error, timeout) is interrupted; a finished turn is left alone.
          if (collector && !collector.terminal) {
            collector.cancel()
            interrupt()
          }
        }
      }
    },
  }
}
