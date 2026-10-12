/**
 * The session-backed `ModelCaller`: one model call = one kept OpenCode session in the caller
 * app's directory under the data root, one model step.
 *
 * Lifecycle of `stream()`: validate the app name, prepare images, create the session, register
 * its request state, start the prompt, then relay the collector's events until it is terminal.
 * Abort is checked before every side effect (directory, backend, create, register, prompt), and
 * the awaited host call (create) is raced against the request signal; teardown never is.
 * Request sessions are registered in the process-wide session store (`state.ts`) so the
 * app-directory hook (`context.ts`) and the event pump can find them.
 *
 * The response and the host execution have different lifetimes (docs/architecture.md). When the
 * response is over, `finally` interrupts unless the host already reported the end of the
 * execution or the turn settled with a plain stop (a step can fail while the runner goes on) and hands the store entry, the
 * request guard, to `sessions.retire`: it stays until the host reports the end of the execution
 * or a bounded cleanup runs out (logged). Nothing here waits for that.
 */

import { randomUUID } from "node:crypto"
import { raceAbort } from "../abort.js"
import { APP_NAME_PATTERN, DEFAULT_APP, appPolicy, type AppPolicy, type PlugboardOptions } from "../config.js"
import { isPlugError, type CallContext, type ModelCaller, type PlugError, type PlugEvent, type PlugRequest } from "../contract.js"
import { log, logError, logWarn } from "../log.js"
import { checkAppModel, type Persona } from "../models.js"
import { RequestCollector } from "./events.js"
import { ensureAppDir, makeTitle, renderTranscript } from "./history.js"
import { describeError, type SessionPort } from "./host.js"
import { ImageError, prepareImages, type RemoteImages } from "./media.js"
import { REQUEST_PERMISSIONS, seedToolsFor } from "./seeds.js"
import type { SessionStore } from "./state.js"

export interface SessionCallerDeps {
  readonly port: SessionPort
  /** The process-wide store request sessions are registered in. */
  readonly sessions: SessionStore
  /** The seed pool size of the app directories (option `maxTools`); a request needing more tools fails before dispatch. */
  readonly maxTools: number
  /** Per-app policy (option `apps`): model scope, tools off, a lower tool cap. The system prompt part is applied by the context hook. */
  readonly apps?: PlugboardOptions["apps"]
  /** Allow fetching http(s) image URLs (option `remoteImages`: off, public addresses only, or with an allowlist). */
  readonly remoteImages?: RemoteImages
  /**
   * Make sure the backend of `app` can run request sessions (the app directory's plugin is loaded),
   * called right before `session.create`. An error ends the request without creating anything.
   */
  readonly ensureBackend?: (app: string, signal: AbortSignal) => Promise<PlugError | undefined>
  /**
   * What the requested name stands for beyond a plain model (`personaOf` in src/models.ts): a skill alias adds
   * the skill's content to the system prompt, an agent runs its own system prompt and OpenCode agent.
   */
  readonly persona?: (model: string) => Persona | undefined
}

/** How long the request guard may outlive the response while the host has not reported the end of the execution. */
const CLEANUP_TIMEOUT_MS = 30_000

const failure = (status: number, message: string, code: string): PlugEvent => ({
  type: "error",
  error: { status, kind: status >= 500 ? "server" : "invalid_request", message, code },
})

const notFound = (message: string): PlugError => ({ status: 404, kind: "not_found", message, code: "model_not_found", param: "model" })

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

/**
 * The app's tool policy applied to the request: `tools: false` drops every tool (and a tool choice that
 * would refer to them). Returns the request the session is built from, and whether anything was dropped.
 * Note that a `response_format` of `json_schema` is answered through a tool, so it is dropped too.
 */
function applyToolPolicy(request: PlugRequest, policy: AppPolicy | undefined): { request: PlugRequest; stripped: boolean } {
  if (policy?.tools !== false) return { request, stripped: false }
  const { toolChoice: _dropped, ...rest } = request
  return { request: { ...rest, tools: [] }, stripped: request.tools.length > 0 }
}

/** An app's own `maxTools`, checked on top of the global one (which `checkPreparation` and the request decoders enforce). */
function checkAppTools(request: PlugRequest, app: string, policy: AppPolicy | undefined): PlugError | undefined {
  const max = policy?.maxTools
  if (max === undefined || request.tools.length <= max) return undefined
  return {
    status: 400,
    kind: "invalid_request",
    code: "too_many_tools",
    param: "tools",
    message: `Request has ${request.tools.length} tools; app ${app} allows ${max} (option \`apps.${app}.maxTools\`)`,
  }
}
export function createSessionCaller(deps: SessionCallerDeps): ModelCaller {
  const { port, sessions, maxTools, ensureBackend } = deps
  const apps = deps.apps ?? {}
  const remoteImages = deps.remoteImages ?? false

  return {
    async *stream(called: PlugRequest, context: CallContext): AsyncGenerator<PlugEvent> {
      const app = APP_NAME_PATTERN.test(context.app) || context.app === DEFAULT_APP ? context.app : undefined
      if (!app) return yield failure(400, `Invalid app name: ${context.app}`, "invalid_app")
      if (context.signal.aborted) return

      const requestID = randomUUID()
      const startedAt = Date.now()
      let outcome = "cancelled"
      // Whether the model produced anything at all (text, reasoning or a tool call), for `answer.empty` (#172).
      let produced = false
      const note = (event: PlugEvent): PlugEvent => {
        if (event.type === "finish") outcome = `finish:${event.reason}`
        else if (event.type === "error") outcome = `error:${event.error.status}${event.error.code ? `:${event.error.code}` : ""}`
        else produced = true
        return event
      }

      // The app's policy: model scope first (a model outside it is as unknown as one off the allowlist), then tools.
      const policy = appPolicy({ apps }, app)
      const outOfScope = checkAppModel(policy, called.model, called.ref)
      if (outOfScope) return yield note({ type: "error", error: outOfScope })
      let { request, stripped } = applyToolPolicy(called, policy)
      const tooMany = checkAppTools(request, app, policy)
      if (tooMany) return yield note({ type: "error", error: tooMany })
      if (stripped) {
        try {
          context.onPolicy?.(["tools-stripped"])
        } catch (error) {
          logError("request.on_policy_failed", { app, error: describeError(error) })
        }
      }

      let sessionID: string | undefined
      let collector: RequestCollector | undefined
      let promptStarted = false
      let interruptRequested = false
      const interrupt = () => {
        if (sessionID) {
          interruptRequested = true
          void port.interrupt(sessionID).catch((error) => logError("session.interrupt_failed", { requestID, app, error: describeError(error) }))
        }
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
        if (context.signal.aborted) return
        const directory = await ensureAppDir(app)
        if (isPlugError(directory)) return yield note({ type: "error", error: directory })

        // 3. The backend must be able to run the session before it is created.
        if (context.signal.aborted) return
        const unavailable = await ensureBackend?.(app, context.signal)
        if (unavailable) return yield note({ type: "error", error: unavailable })
        if (context.signal.aborted) return

        // 3b. A persona (see `Persona`). A skill's content leads the system prompt; an agent's prompt replaces the
        // caller's, and the session runs as that agent. Its permissions are still REQUEST_PERMISSIONS (deny all, then seeds).
        const persona = deps.persona?.(called.model)
        let prelude: ReadonlyArray<string> = []
        if (persona?.kind === "skill") {
          const content = await port.skill(directory, persona.skill)
          if (content === undefined) return yield note({ type: "error", error: notFound(`Skill ${persona.skill} is not available`) })
          prelude = [content]
        } else if (persona?.kind === "agent") {
          const agent = await port.agent(directory, persona.agent)
          if (agent === undefined) return yield note({ type: "error", error: notFound(`Agent ${persona.agent} is not available`) })
          request = { ...request, system: agent.system ? [agent.system] : [] }
        }
        if (context.signal.aborted) return

        collector = new RequestCollector({ stopTurn: interrupt, requestID })
        const creating = port.create({
          directory,
          model: { providerID: request.ref.providerID, id: request.ref.id, ...(request.ref.variant ? { variant: request.ref.variant } : {}) },
          ...(persona?.kind === "agent" ? { agent: persona.agent } : {}),
          title: makeTitle(request),
          metadata: { plugboard: { app, model: request.model, requestID } },
          permissions: REQUEST_PERMISSIONS,
        })
        const created = await raceAbort(creating, context.signal).catch((error) => {
          // The host keeps creating after the abort. A session that lands now is in no index, so it is removed.
          if (context.signal.aborted)
            void creating.then(
              (late) => port.remove(late.id).catch((removeError) => logError("session.late_remove_failed", { requestID, app, sessionID: late.id, error: describeError(removeError) })),
              () => {},
            )
          throw error
        })
        sessionID = String(created.id)
        sessions.register({ sessionID, app, requestID, request, collector, prelude })

        context.signal.addEventListener("abort", onAbort, { once: true })
        if (context.signal.aborted) return onAbort()

        // The history id is known from here on: tell the front-end before the first event.
        try {
          context.onRecord?.(sessionID, directory)
        } catch (error) {
          logError("request.on_record_failed", { requestID, app, error: describeError(error) })
        }

        // 4. Prompt concurrently; events stream through the collector while it runs.
        if (context.signal.aborted) return onAbort()
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
          // The response may be over (consumer left early, error, timeout, a failed step) while the
          // host keeps running the session: interrupt unless it reported the end of the execution
          // or the step ended plainly (the runner stops by itself), and only if no interrupt went
          // out yet (the tool-calls path asked at the step end already).
          if (!collector.terminal) collector.cancel()
          if (!collector.executionEnded && !collector.turnSettled && !interruptRequested) interrupt()
          // The response ends here, the host execution may not have: the guard is kept until it does.
          if (promptStarted) sessions.retire(sessionID, { timeoutMs: CLEANUP_TIMEOUT_MS, onTimeout: interrupt })
          else sessions.release(sessionID)
        }
        // A turn that stopped with nothing in it is kept as a session for inspection: the session id finds it.
        if (outcome === "finish:stop" && !produced) logWarn("answer.empty", { requestID, app, model: request.model, sessionID, tools: request.tools.length })
        log("request.finished", { requestID, app, model: request.model, durationMs: Date.now() - startedAt, outcome })
      }
    },
  }
}
