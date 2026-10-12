/**
 * Context hook and seed tools: what plugboard installs inside the app directories, and what the
 * `session.hook("context")` hook does for a plugboard request session.
 *
 * The stored prompt is only a readable transcript. The hook swaps in the caller's real
 * structured system, messages, tool definitions and generation options. Sessions that are not
 * plugboard requests (not in the process-wide session store) are untouched.
 */

import { Effect } from "effect"
import { appPolicy, type AppPolicy, type PlugboardOptions } from "../config.js"
import type { PlugError, PlugMessage, PlugRequest } from "../contract.js"
import { log } from "../log.js"
import type { ContextHookEvent, HostContext, HostPart, HostToolDescriptor } from "./host.js"
import { SEED_PREFIX, SEED_RESULT, seedToolsFor } from "./seeds.js"
import { FAILURE_EVENT, type SessionStore } from "./state.js"

const text = (value: string): HostPart => ({ type: "text", text: value })

/** The host's cache breakpoint: the default 5-minute one, the only kind plugboard carries (#275). */
const EPHEMERAL = { type: "ephemeral" } as const

/** Placeholder for a caller image; swapped for the host-built media part in `applyContext`. */
const mediaPlaceholder = (index: number, cache: boolean | undefined): HostPart => ({ type: "media", __attachment: index, ...(cache ? { cache: EPHEMERAL } : {}) })

/** Caller messages as host `Message` objects. Media placeholders are swapped in `applyContext`. */
function toHostMessages(messages: ReadonlyArray<PlugMessage>): Array<{ role: string; content: HostPart[] }> {
  let image = 0
  const part = (item: PlugMessage["content"][number]): HostPart => {
    switch (item.type) {
      case "text":
        return item.cache ? { ...text(item.text), cache: EPHEMERAL } : text(item.text)
      case "media":
        return mediaPlaceholder(image++, item.cache)
      case "tool-call":
        return { type: "tool-call", id: item.id, name: item.name, input: item.input }
      case "tool-result":
        return { type: "tool-result", id: item.id, name: item.name, result: { type: "text", value: item.result }, ...(item.cache ? { cache: EPHEMERAL } : {}) }
    }
  }
  return messages.map((message) => ({ role: message.role, content: message.content.map(part) }))
}

function generationOptions(request: PlugRequest): Record<string, unknown> {
  const generation = request.generation
  const options: Record<string, unknown> = {}
  if (generation.maxTokens !== undefined) options.maxTokens = generation.maxTokens
  if (generation.temperature !== undefined) options.temperature = generation.temperature
  if (generation.topP !== undefined) options.topP = generation.topP
  if (generation.stop !== undefined) options.stop = [...generation.stop]
  if (generation.presencePenalty !== undefined) options.presencePenalty = generation.presencePenalty
  if (generation.frequencyPenalty !== undefined) options.frequencyPenalty = generation.frequencyPenalty
  return options
}

/**
 * Re-key the registered seed tools onto the caller's tool names.
 *
 * Descriptor object identity is load-bearing: the host maps a rewritten tool back to its
 * registered tool by the descriptor object it handed to the hook (upstream
 * `model-request.ts`, tool mapping after the `context` hook), so the descriptors are mutated in
 * place and the very same objects are re-inserted under the caller's names. Never copy them.
 * Returns how many caller tools got no seed (zero unless the seed pool is smaller than the request
 * needs, or two caller tools share a name and would collapse into one key).
 *
 * The app's `serverTools` (option `apps`) are kept as the host offered them: their descriptors were
 * never rewritten, so the host runs the real tool. Not offered when the caller set `tool_choice` none.
 *
 * The map is built with `Object.fromEntries`: a tool named `__proto__` becomes an own key like any
 * other instead of assigning the prototype and vanishing.
 */
function remapSeedTools(session: ContextHookEvent, request: PlugRequest, serverTools: ReadonlyArray<string>): number {
  const seeds = Object.entries(session.tools ?? {}).filter(([name]) => name.startsWith(SEED_PREFIX))
  const tools = seedToolsFor(request)
  const next = new Map<string, HostToolDescriptor>()
  let index = 0
  for (const tool of tools) {
    const seed = seeds[index]
    if (!seed) break
    index++
    if (next.has(tool.name)) continue
    const descriptor = seed[1]
    descriptor.description = tool.description
    descriptor.input = tool.parameters
    next.set(tool.name, descriptor)
  }
  const missing = tools.length - next.size
  if (request.toolChoice !== "none") {
    const offered = session.tools ?? {}
    for (const name of serverTools) {
      if (!Object.hasOwn(offered, name) || next.has(name)) continue
      next.set(name, offered[name] as HostToolDescriptor)
    }
  }
  session.tools = Object.fromEntries(next)
  return missing
}

/**
 * The caller's system prompts with the app's `system` applied: before them (default), after them, or
 * instead of them (`replace` also drops instructions the front-end put there, such as the JSON-mode one).
 */
function systemFor(caller: ReadonlyArray<string>, policy: AppPolicy | undefined): ReadonlyArray<string> {
  if (policy?.system === undefined) return caller
  switch (policy.systemMode) {
    case "prepend":
      return [policy.system, ...caller]
    case "append":
      return [...caller, policy.system]
    case "replace":
      return [policy.system]
  }
}

/**
 * The system prompts the model reads for a request, in order: the skill prelude, the caller's system prompts with the app's
 * `system` policy applied, then the tool-choice steering (the OpenCode session API has no tool-choice control, so a forced or
 * required tool is steered by instruction). The context hook sends these, and `count_tokens` counts them (#201), so the two
 * cannot drift.
 */
export function requestSystem(request: Pick<PlugRequest, "system" | "toolChoice">, prelude: ReadonlyArray<string>, policy: AppPolicy | undefined): string[] {
  const system = [...prelude, ...systemFor(request.system, policy)]
  const choice = request.toolChoice
  if (choice === "required") system.push("You must respond by calling one of the provided tools.")
  if (typeof choice === "object") system.push(`You must respond by calling the \`${choice.name}\` tool.`)
  return system
}

/** The one 500 message for a request plugboard could not prepare. What was missing is logged, never sent: it names host internals (#288). */
const preparationFailed = (): PlugError => ({ status: 500, kind: "server", code: "backend_preparation_failed", message: "Could not prepare the model request" })

/**
 * `session.hook("context")` body: swap the request session's system, messages, tools and
 * generation options for the caller's, with the app's system prompt (option `apps`) applied.
 */
function applyContext(event: unknown, sessions: SessionStore, apps: PlugboardOptions["apps"]): void {
  // Assumed invariant: the host passes its mutable `SessionContext` (checked structurally by `HostContextMatches`).
  const session = event as ContextHookEvent
  const state = sessions.lookup(String(session.sessionID))
  if (!state) return
  const { request } = state
  const policy = appPolicy({ apps }, state.app)

  // Swap media placeholders for the Asset-carrying parts the host built from the prompt files.
  const hostMedia = (session.messages ?? [])
    .flatMap((message) => (Array.isArray(message.content) ? (message.content as unknown[]) : []))
    .filter((part) => (part as HostPart | undefined)?.type === "media")
  let missingMedia = 0
  const swap = (part: HostPart) => {
    if (typeof part.__attachment !== "number") return part
    const media = hostMedia[part.__attachment]
    if (media) return part.cache ? { ...media, cache: EPHEMERAL } : media
    missingMedia++
    return text("[image unavailable]")
  }

  session.system = requestSystem(request, state.prelude ?? [], policy).map(text)
  session.messages = toHostMessages(request.messages).map((message) => ({ ...message, content: message.content.map(swap) }))
  Object.assign(session.options ?? (session.options = {}), generationOptions(request))

  const missingTools = remapSeedTools(session, request, policy?.serverTools ?? [])

  // The caller validates both before dispatch; this only fires if the host disagrees. The request is
  // already rewritten (no real tool can run); fail it instead of answering from a truncated prompt.
  if (missingMedia > 0 || missingTools > 0) {
    log("request.preparation_failed", { missing_media: missingMedia, missing_tools: missingTools })
    state.collector.push({ type: FAILURE_EVENT, error: preparationFailed() })
  }
}

/**
 * Registrations for a plugboard Location: the context hook, the agent deny for the seeds, and
 * the seed tool pool.
 *
 * Whether the Location is inside the data root is only known after an asynchronous filesystem
 * check (never during setup), so these are registered for every accepted generation and every
 * one of them stays a no-op until `active()` turns true: the hook leaves sessions alone, the
 * transforms add and change nothing. `active` is read synchronously on every run; the owner
 * rebuilds the transforms (`ctx.agent.reload()`, `ctx.tool.reload()`) after it flips.
 *
 * Every agent denies the seeds; request sessions are created with a session permission that
 * allows them again, so a person prompting inside an app directory is never offered them.
 * Registration only: no host call that waits on readiness (see docs/architecture.md).
 */
export function installSessionHooks(
  ctx: HostContext,
  options: { readonly maxTools: number; readonly sessions: SessionStore; readonly active: () => boolean; readonly apps?: PlugboardOptions["apps"] },
) {
  return Effect.gen(function* () {
    // Swap in the caller's system/messages/tools for plugboard request sessions only.
    yield* ctx.session.hook("context", (event) => Effect.sync(() => (options.active() ? applyContext(event, options.sessions, options.apps ?? {}) : undefined)))

    yield* ctx.agent.transform((editor) => {
      if (!options.active()) return
      for (const agent of editor.list()) {
        editor.update(agent.id, (item) => {
          item.permissions.push({ action: `${SEED_PREFIX}*`, resource: "*", effect: "deny" })
        })
      }
    })
    yield* ctx.tool.transform((editor) => {
      if (!options.active()) return
      for (let index = 0; index < options.maxTools; index++) {
        editor.add({
          name: `${SEED_PREFIX}${index}`,
          description: "Plugboard placeholder tool.",
          input: { type: "object", properties: {}, additionalProperties: true },
          options: { codemode: false },
          // Settles at once so history shows a completed call; plugboard ends the turn itself (see seeds.ts).
          execute: () => Effect.succeed({ content: SEED_RESULT }),
        })
      }
    })
  })
}
