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
import { APP_NAME_PATTERN, DEFAULT_APP, DEFAULT_SERVER_TOOL_CALLS, DEFAULT_SERVER_TOOL_STEPS, appPolicy, type AppPolicy, type AffinityScope, type PlugboardOptions, type PromptCache } from "../config.js"
import { isPlugError, type CallContext, type ModelCaller, type PlugError, type PlugEvent, type PlugRequest } from "../contract.js"
import { log, logError, logRequest, logWarn } from "../log.js"
import { checkAppModel, type Persona } from "../models.js"
import { RequestCollector } from "./events.js"
import { requestSystem } from "./context.js"
import { ensureAppDir, makeTitle, renderTranscript } from "./history.js"
import { describeError, MissingParentError, type DirectToolSchema, type SessionPort } from "./host.js"
import { ImageError, prepareImages, type RemoteImages } from "./media.js"
import { requestPermissions, seedToolsFor, ungrantedServerTool, type OperatorRule } from "./seeds.js"
import { maxAnchorsOf, PROMPT_CACHE_OFF, scopeKey, type Affinity } from "./affinity.js"
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
  /** Global prompt-cache affinity (option `promptCache`); an app's `apps.<name>.promptCache` overrides it. Absent: off. */
  readonly promptCache?: PromptCache
  /** The store of anchor sessions (src/session/affinity.ts). Absent: no affinity, whatever the policy says. */
  readonly affinity?: Affinity
  /** Global `history.hidden` (since 0.29.0, #337); an app's `apps.<name>.history.hidden` overrides it. Absent: off. */
  readonly historyHidden?: boolean
}

/** How long the request guard may outlive the response while the host has not reported the end of the execution. */
const CLEANUP_TIMEOUT_MS = 30_000

const failure = (status: number, message: string, code: string): PlugEvent => ({
  type: "error",
  error: { status, kind: status >= 500 ? "server" : "invalid_request", message, code },
})

/** The anchor session's title (`plugboard anchor: <app>[/<key>]`); it is never prompted. */
const anchorTitle = (app: string, key: string): string => (key === "" ? `plugboard anchor: ${app}` : `plugboard anchor: ${app}/${key}`)
/** The parent of an app with `history.hidden` (#337): one per app, titled `plugboard: <app>`. Never prompted, never indexed. */
const hiddenParentTitle = (app: string): string => `plugboard: ${app}`

const notFound = (message: string): PlugError => ({ status: 404, kind: "not_found", message, code: "model_not_found", param: "model" })

const countMedia = (request: PlugRequest): number =>
  request.messages.reduce((sum, message) => sum + message.content.filter((part) => part.type === "media").length, 0)

/** Everything the hook will need must exist before dispatch: one prompt file per image, one seed tool per offered tool. */
function checkPreparation(request: PlugRequest, images: number, maxTools: number): PlugError | undefined {
  const wanted = countMedia(request)
  if (images !== wanted) {
    // The counts are for the log only; the caller gets the generic message (#288).
    log("request.preparation_failed", { images, wanted })
    return { status: 500, kind: "server", code: "backend_preparation_failed", message: "Could not prepare the model request" }
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
 * The app's tool policy applied to the request: `tools: false` drops the caller's tools (and a tool choice that
 * would refer to them). A structured answer (`json_schema`) is carried by the `respond` tool (`structuredTool`), which
 * stays and is forced, so the app keeps its structured output (#252). Returns the request the session is built from,
 * and whether a caller tool was dropped.
 */
function applyToolPolicy(request: PlugRequest, policy: AppPolicy | undefined): { request: PlugRequest; stripped: boolean } {
  if (policy?.tools !== false) return { request, stripped: false }
  const structured = request.structuredTool
  const kept = structured === undefined ? [] : request.tools.filter((tool) => tool.name === structured)
  if (structured === undefined || kept.length === 0) {
    const { toolChoice: _dropped, ...rest } = request
    return { request: { ...rest, tools: [] }, stripped: request.tools.length > 0 }
  }
  return { request: { ...request, tools: kept, toolChoice: { type: "tool", name: structured } }, stripped: request.tools.length > kept.length }
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
/** A caller tool may not share a name with one of the app's server tools: the model would see two tools under one name. */
function checkServerToolNames(request: PlugRequest, policy: AppPolicy | undefined): PlugError | undefined {
  const clash = request.tools.find((tool) => policy?.serverTools?.includes(tool.name))
  if (!clash) return undefined
  return {
    status: 400,
    kind: "invalid_request",
    code: "server_tool_collision",
    param: "tools",
    message: `Tool \`${clash.name}\` is one of this app's OpenCode server tools (option \`apps.<name>.serverTools\`); rename the caller's tool`,
  }
}

/** A listed server tool the operator's permissions for the agent do not allow (#194): nothing is created. */
function deniedByOperator(tool: string): PlugError {
  return {
    status: 400,
    kind: "invalid_request",
    code: "server_tool_denied_by_operator",
    param: "tools",
    message: `The OpenCode permissions of this app's agent do not allow \`${tool}\` (option \`apps.<name>.serverTools\`). Add an allow rule for it to the agent, or remove it from serverTools`,
  }
}

/** Every server tool must be a direct tool of this location right now (fail closed; checked per request, never at setup). */
async function checkServerToolsAvailable(port: SessionPort, policy: AppPolicy | undefined, signal: AbortSignal): Promise<PlugError | undefined> {
  if (!policy?.serverTools) return undefined
  const offered = new Set(await raceAbort(port.directTools(), signal))
  const missing = policy.serverTools.filter((tool) => !offered.has(tool))
  if (missing.length === 0) return undefined
  return {
    status: 400,
    kind: "invalid_request",
    code: "server_tool_unavailable",
    message: `OpenCode tool(s) not available in this location: ${missing.join(", ")} (option \`apps.<name>.serverTools\`). CodeMode tools, including MCP tools by default, cannot be listed; set codemode: false on the tool`,
  }
}

/** The prompt a persona adds to a request session (#79): a skill's content leads the system prompt, an agent's prompt replaces the caller's. */
export interface PersonaPrompt {
  /** Goes before the caller's system prompts (a skill's content). */
  readonly prelude: ReadonlyArray<string>
  /** Replaces the caller's system prompts (an agent's prompt). Absent when the persona keeps them. */
  readonly system?: ReadonlyArray<string>
}

/** Reads a persona's prompt in the app directory `directory`. A skill or agent that is not there is a 404, as the request answers it. */
export async function personaPrompt(port: SessionPort, directory: string, persona: Persona | undefined): Promise<PersonaPrompt | PlugError> {
  if (persona?.kind === "skill") {
    const content = await port.skill(directory, persona.skill)
    return content === undefined ? notFound(`Skill ${persona.skill} is not available`) : { prelude: [content] }
  }
  if (persona?.kind === "agent") {
    const agent = await port.agent(directory, persona.agent)
    return agent === undefined ? notFound(`Agent ${persona.agent} is not available`) : { prelude: [], system: agent.system ? [agent.system] : [] }
  }
  return { prelude: [] }
}

/** What a count route needs from the session: the port, the persona lookup and the backend readiness (see `SessionCallerDeps`). */
export type SessionPromptDeps = Pick<SessionCallerDeps, "port" | "persona" | "ensureBackend">

/**
 * The request as the session sends it, for `count_tokens` and `countTokens` (#201): the same refusals as `stream` (model scope,
 * tool count, server-tool name clash, the app's server tools' existence and operator grant), the app's tool policy, the persona's
 * prompt, the system prompt with the app's policy and steering, and the tools the session offers: the caller's tools that get a
 * seed (`seedToolsFor`) and the app's server-tool schemas, unless the tool choice is `none`. Returns the request with `system` and
 * `tools` as the model reads them, or the error the request would stop with. The persona and server tools are read from the
 * session only when there are some and `deps` is given. Side effects, as the request has them: the app directory is created and
 * the Location may boot (`ensureAppDir`, `ensureBackend`), and a backend that is not ready answers 503. Image preparation (remote
 * fetches) is not run. `app` is the authenticated app name, validated by config, so the caller's name check is not repeated.
 */
export async function sessionRequest(
  deps: SessionPromptDeps | undefined,
  app: string,
  called: PlugRequest,
  policy: AppPolicy | undefined,
  signal: AbortSignal,
): Promise<PlugRequest | PlugError> {
  // The pure refusals first, in the order `stream` makes them: a count never sizes a request that would be refused.
  const outOfScope = checkAppModel(policy, called.model, called.ref)
  if (outOfScope) return outOfScope
  let { request } = applyToolPolicy(called, policy)
  const tooMany = checkAppTools(request, app, policy)
  if (tooMany) return tooMany
  const clash = checkServerToolNames(request, policy)
  if (clash) return clash

  const persona = deps?.persona?.(called.model)
  const serverTools = policy?.serverTools
  let prelude: ReadonlyArray<string> = []
  let serverSchemas: ReadonlyArray<DirectToolSchema> = []
  if (deps && (persona !== undefined || serverTools !== undefined)) {
    const directory = await ensureAppDir(app)
    if (isPlugError(directory)) return directory
    const unavailable = await deps.ensureBackend?.(app, signal)
    if (unavailable) return unavailable
    const missing = await checkServerToolsAvailable(deps.port, policy, signal)
    if (missing) return missing
    const parts = await personaPrompt(deps.port, directory, persona)
    if (isPlugError(parts)) return parts
    prelude = parts.prelude
    if (parts.system !== undefined) request = { ...request, system: [...parts.system] }
    if (serverTools !== undefined) {
      // The operator's grant for the agent the session runs as (#194): an ungranted tool is refused before any session exists.
      const rules = (await raceAbort(deps.port.agentRules(directory, persona?.kind === "agent" ? persona.agent : undefined), signal)) ?? []
      const ungranted = ungrantedServerTool(serverTools, rules)
      if (ungranted) return deniedByOperator(ungranted)
      // Offered only when the tool choice allows tools, as the context hook does (src/session/context.ts).
      if (request.toolChoice !== "none") {
        const offered = await raceAbort(deps.port.directToolSchemas(), signal)
        serverSchemas = offered.filter((tool) => serverTools.includes(tool.id))
      }
    }
  }
  return {
    ...request,
    system: requestSystem(request, prelude, policy),
    tools: [...seedToolsFor(request), ...serverSchemas.map((tool) => ({ name: tool.id, description: tool.description, parameters: tool.input }))],
  }
}


export function createSessionCaller(deps: SessionCallerDeps): ModelCaller {
  const { port, sessions, maxTools, ensureBackend } = deps
  const affinity = deps.affinity
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
      const clash = checkServerToolNames(request, policy)
      if (clash) return yield note({ type: "error", error: clash })
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

        // 2. The app directory under the data root; one session per request (top-level, or under the app's parent: step 3c).
        if (context.signal.aborted) return
        const directory = await ensureAppDir(app)
        if (isPlugError(directory)) return yield note({ type: "error", error: directory })

        // 3. The backend must be able to run the session before it is created.
        if (context.signal.aborted) return
        const unavailable = await ensureBackend?.(app, context.signal)
        if (unavailable) return yield note({ type: "error", error: unavailable })
        if (context.signal.aborted) return
        const missingServerTools = await checkServerToolsAvailable(port, policy, context.signal)
        if (missingServerTools) return yield note({ type: "error", error: missingServerTools })
        if (context.signal.aborted) return

        // 3b. A persona (see `Persona`). A skill's content leads the system prompt; an agent's prompt replaces the
        // caller's, and the session runs as that agent. Its permissions are still REQUEST_PERMISSIONS (deny all, then seeds).
        const persona = deps.persona?.(called.model)
        const parts = await personaPrompt(port, directory, persona)
        if (isPlugError(parts)) return yield note({ type: "error", error: parts })
        const { prelude } = parts
        if (parts.system !== undefined) request = { ...request, system: [...parts.system] }
        if (context.signal.aborted) return

        // 3c. An app with server tools runs them under the agent's own rules (#194): read them now, for the agent this session runs as.
        let operatorRules: ReadonlyArray<OperatorRule> = []
        if (policy?.serverTools) {
          operatorRules = (await raceAbort(port.agentRules(directory, persona?.kind === "agent" ? persona.agent : undefined), context.signal)) ?? []
          const ungranted = ungrantedServerTool(policy.serverTools, operatorRules)
          if (ungranted) return yield note({ type: "error", error: deniedByOperator(ungranted) })
        }
        if (context.signal.aborted) return

        collector = new RequestCollector({
          stopTurn: interrupt,
          requestID,
          app,
          ...(request.parallelToolCalls === false ? { singleToolCall: true } : {}),
          ...(policy?.serverTools
            ? {
                serverTools: new Set(policy.serverTools),
                maxServerToolSteps: policy.maxServerToolSteps ?? DEFAULT_SERVER_TOOL_STEPS,
                maxServerToolCalls: policy.maxServerToolCalls ?? DEFAULT_SERVER_TOOL_CALLS,
              }
            : {}),
        })

        // 3c. Prompt-cache affinity (#80): under an anchor the request session is its child, so the provider cache key
        // stays the anchor's id across requests (src/session/affinity.ts). `history.hidden` (#337) uses the same parent
        // machinery: the app-scope anchor, which an app's promptCache app-scope anchor shares.
        const cache = appPolicy({ apps }, app)?.promptCache ?? deps.promptCache ?? PROMPT_CACHE_OFF
        const hidden = (appPolicy({ apps }, app)?.history?.hidden ?? deps.historyHidden) === true
        const anchored = cache.affinity === "anchor" || hidden
        const keyScope: AffinityScope = hidden ? "app" : cache.scope
        const scope = affinity && anchored ? (hidden ? "" : scopeKey(cache, called)) : undefined
        const modelRef = { providerID: request.ref.providerID, id: request.ref.id, ...(request.ref.variant ? { variant: request.ref.variant } : {}) }
        const makeAnchor = (): Promise<string> =>
          port.create({
            directory,
            model: modelRef,
            title: hidden ? hiddenParentTitle(app) : anchorTitle(app, scope ?? ""),
            metadata: { plugboard: { app, anchor: true } },
            permissions: requestPermissions([]),
          }).then((made) => String(made.id))
        let parentID: string | undefined
        const maxAnchors = maxAnchorsOf(cache)
        if (affinity && scope !== undefined) parentID = await raceAbort(affinity.anchor(app, keyScope, scope, maxAnchors, makeAnchor), context.signal)
        if (hidden && parentID === undefined && scope !== undefined) logWarn("history.hidden_parent_unavailable", { requestID, app })
        if (context.signal.aborted) return

        const makeChild = (parent: string | undefined) => {
          const creating = port.create({
            directory,
            model: modelRef,
            ...(persona?.kind === "agent" ? { agent: persona.agent } : {}),
            title: makeTitle(request),
            metadata: { plugboard: { app, model: request.model, requestID } },
            permissions: requestPermissions(policy?.serverTools ?? [], operatorRules),
            ...(parent === undefined ? {} : { parentID: parent }),
          })
          return raceAbort(creating, context.signal).catch((error) => {
            // The host keeps creating after the abort. A session that lands now is in no index, so it is removed.
            if (context.signal.aborted)
              void creating.then(
                (late) => port.remove(late.id).catch((removeError) => logError("session.late_remove_failed", { requestID, app, sessionID: late.id, error: describeError(removeError) })),
                () => {},
              )
            throw error
          })
        }
        let created: { id: string }
        try {
          created = await makeChild(parentID)
        } catch (error) {
          // The anchor was deleted in OpenCode: forget its record, make one anchor and retry the child once (never more).
          if (!(error instanceof MissingParentError) || affinity === undefined || scope === undefined || parentID === undefined) throw error
          logWarn("affinity.anchor_recreated", { requestID, app, previous: parentID })
          await affinity.forget(app, keyScope, scope)
          parentID = await raceAbort(affinity.anchor(app, keyScope, scope, maxAnchors, makeAnchor), context.signal)
          created = await makeChild(parentID)
        }
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
        if (cache.affinity === "anchor") {
          try {
            context.onAffinity?.(parentID === undefined ? "none" : "anchor")
          } catch (error) {
            logError("request.on_affinity_failed", { requestID, app, error: describeError(error) })
          }
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
        const serverToolCalls = collector?.serverCallCount ?? 0
        if (serverToolCalls > 0 && context.onServerTools) {
          try {
            context.onServerTools(serverToolCalls)
          } catch (error) {
            logError("request.on_server_tools_failed", { requestID, app, error: describeError(error) })
          }
        }
        // A turn that stopped with nothing in it is kept as a session for inspection: the session id finds it.
        if (outcome === "finish:stop" && !produced) logWarn("answer.empty", { requestID, app, model: request.model, sessionID, tools: request.tools.length })
        logRequest("request.finished", { requestID, app, model: request.model, durationMs: Date.now() - startedAt, outcome })
      }
    },
  }
}
