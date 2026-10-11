/**
 * The session-backed `ModelCaller`: one model call = one kept OpenCode session in the caller
 * app's directory under the data root, one model step.
 *
 * Lifecycle of `stream()`: validate the app name, prepare images, create the session, register
 * its request state, start the prompt, then relay the collector's events until it is terminal.
 * Request sessions are registered in the process-wide session store (`state.ts`) so the
 * app-directory hook (`context.ts`) and the event pump can find them.
 *
 * The response and the host execution have different lifetimes (docs/architecture.md). When the
 * response is over, `finally` interrupts anything still running and hands the store entry, the
 * request guard, to `sessions.retire`: it stays until the host reports the end of the execution
 * or a bounded cleanup runs out (logged). Nothing here waits for that.
 */

import { randomUUID } from "node:crypto"
import { APP_NAME_PATTERN, DEFAULT_APP } from "../config.js"
import { isPlugError, type CallContext, type ModelCaller, type PlugError, type PlugEvent, type PlugRequest } from "../contract.js"
import { log, logError } from "../log.js"
import { RequestCollector } from "./events.js"
import { ensureAppDir, makeTitle, renderTranscript } from "./history.js"
import { describeError, type SessionPort } from "./host.js"
import { ImageError, prepareImages } from "./media.js"
import { REQUEST_PERMISSIONS, seedToolsFor } from "./seeds.js"
import type { SessionStore } from "./state.js"

export interface SessionCallerDeps {
  readonly port: SessionPort
  /** The process-wide store request sessions are registered in. */
  readonly sessions: SessionStore
  /** The seed pool size of the app directories (option `maxTools`); a request needing more tools fails before dispatch. */
  readonly maxTools: number
  /** Allow fetching http(s) image URLs (option `remoteImages`). */
  readonly remoteImages?: boolean
}

/** How long the request guard may outlive the response while the host has not reported the end of the execution. */
const CLEANUP_TIMEOUT_MS = 30_000

const failure = (status: number, message: string, code: string): PlugEvent => ({
  type: "error",
  error: { status, kind: status >= 500 ? "server" : "invalid_request", message, code },
})

const countMedia = (request: PlugRequest): number =>
  request.messages.reduce((sum, message) => sum + message.content.filter((part) => part.type === "media").length, 0)

/** Everything the hook will need must exist before dispatch: one prompt file per image, one seed tool per offered tool. */
function checkPreparation(request: PlugRequest, images: number, maxTools: number): PlugError | undefined {
  const wanted = countMedia(request)
  if (images !== wanted) {
    return { status: 500, kind: "server", code: "backend_preparation_failed", message: `Prepared ${images} attachment(s) for a request with ${wanted}` }
  }
  const tools = seedToolsFor(request).length
  if (tools > maxTools) {
    return {
      status: 400,
      kind: "invalid_request",
      code: "backend_preparation_failed",
      param: "tools",
      message: `The request offers ${tools} tools but plugboard supports at most ${maxTools} (option \`maxTools\`)`,
    }
  }
  return undefined
}

export function createSessionCaller(deps: SessionCallerDeps): ModelCaller {
  const { port, sessions, maxTools } = deps
  const remoteImages = deps.remoteImages === true

  return {
    async *stream(request: PlugRequest, context: CallContext): AsyncGenerator<PlugEvent> {
      const app = APP_NAME_PATTERN.test(context.app) || context.app === DEFAULT_APP ? context.app : undefined
      if (!app) return yield failure(400, `Invalid app name: ${context.app}`, "invalid_app")
      if (context.signal.aborted) return

      const requestID = randomUUID()
      const startedAt = Date.now()
      let outcome = "cancelled"
      const note = (event: PlugEvent): PlugEvent => {
        if (event.type === "finish") outcome = `finish:${event.reason}`
        else if (event.type === "error") outcome = `error:${event.error.status}${event.error.code ? `:${event.error.code}` : ""}`
        return event
      }

      let sessionID: string | undefined
      let collector: RequestCollector | undefined
      let promptStarted = false
      const interrupt = () => {
        if (sessionID)
          void port.interrupt(sessionID).catch((error) => logError("session.interrupt_failed", { requestID, app, error: describeError(error) }))
      }
      const onAbort = () => {
        collector?.cancel()
        interrupt()
      }

      try {
        // 1. Prompt files: images become data URLs (http(s) ones are fetched once).
        const images = await prepareImages(request, context.signal, remoteImages)
        const invalid = checkPreparation(request, images.length, maxTools)
        if (invalid) return yield note({ type: "error", error: invalid })

        // 2. The app directory under the data root; one top-level session per request.
        const directory = await ensureAppDir(app)
        if (isPlugError(directory)) return yield note({ type: "error", error: directory })

        collector = new RequestCollector({ stopTurn: interrupt })
        const created = await port.create({
          directory,
          model: { providerID: request.ref.providerID, id: request.ref.id, ...(request.ref.variant ? { variant: request.ref.variant } : {}) },
          title: makeTitle(request),
          metadata: { plugboard: { app, model: request.model, requestID } },
          permissions: REQUEST_PERMISSIONS,
        })
        sessionID = String(created.id)
        sessions.register({ sessionID, app, requestID, request, collector })

        context.signal.addEventListener("abort", onAbort, { once: true })
        if (context.signal.aborted) return onAbort()

        // The history id is known from here on: tell the front-end before the first event.
        try {
          context.onRecord?.(sessionID)
        } catch (error) {
          logError("request.on_record_failed", { requestID, app, error: describeError(error) })
        }

        // 3. Prompt concurrently; events stream through the collector while it runs.
        const owned = collector
        promptStarted = true
        void port.prompt({ sessionID, text: renderTranscript(request), files: images }).catch((error) => {
          logError("session.prompt_failed", { requestID, app, model: request.model, error: describeError(error) })
          if (owned.terminal) return
          owned.push({ type: "session.execution.failed", error: { type: "prompt_failed", message: "Could not start the model session" } })
        })

        for await (const event of collector.events()) yield note(event)
      } catch (error) {
        if (error instanceof ImageError) yield note(failure(400, error.message, error.code))
        else if (!context.signal.aborted) {
          logError("request.backend_failed", { requestID, app, model: request.model, error: describeError(error) })
          yield note(failure(502, "plugboard session backend failed", "backend_failed"))
        }
      } finally {
        context.signal.removeEventListener("abort", onAbort)
        if (sessionID && collector) {
          // Anything still running (consumer left early, error, timeout) is interrupted; a finished turn is left alone.
          if (!collector.terminal) {
            collector.cancel()
            interrupt()
          }
          // The response ends here, the host execution may not have: the guard is kept until it does.
          if (promptStarted) sessions.retire(sessionID, { timeoutMs: CLEANUP_TIMEOUT_MS, onTimeout: interrupt })
          else sessions.release(sessionID)
        }
        log("request.finished", { requestID, app, model: request.model, durationMs: Date.now() - startedAt, outcome })
      }
    },
  }
}
