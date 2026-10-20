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
import type { PlugError, PlugMessage, PlugRequest, ReasoningPart } from "../contract.js"
import { log } from "../log.js"
import type { ContextHookEvent, HostContext, HostPart, HostToolDescriptor } from "./host.js"
import { SEED_PREFIX, SEED_RESULT, seedToolsFor } from "./seeds.js"
import { FAILURE_EVENT, type SessionStore } from "./state.js"

const text = (value: string): HostPart => ({ type: "text", text: value })

/** The host's cache hint, `ttlSeconds` in seconds. 3600 is the host's 1h bucket (`ttlBucket`), anything less is 5 minutes. */
type Hint = { type: "ephemeral"; ttlSeconds?: number }
const ONE_HOUR = 3600

/** A fresh hint object per call, so no host part shares one. */
const hint = (ttlSeconds?: number): Hint => (ttlSeconds === undefined ? { type: "ephemeral" } : { type: "ephemeral", ttlSeconds })

/** The caller's breakpoint: 1h when the caller asked for it, else the default 5 minutes (#275). */
const hintOf = (cacheTtl: "1h" | undefined): Hint => (cacheTtl === "1h" ? hint(ONE_HOUR) : hint())

/** Placeholder for a caller image; swapped for the host-built media part in `applyContext`. */
const mediaPlaceholder = (index: number, cache: boolean | undefined, cacheTtl: "1h" | undefined): HostPart => ({ type: "media", __attachment: index, ...(cache ? { cache: hintOf(cacheTtl) } : {}) })

/**
 * The metadata key the host's Anthropic route reads a signature from: `providerMetadata["anthropic"]`, the Anthropic route's
 * `providerMetadataKey` (`packages/ai/src/protocols/anthropic-messages.ts`). Replay is gated by `replaysSignedThinking`, so a
 * signature only goes to a model on that route (#374, #386).
 */
const ANTHROPIC_METADATA_KEY = "anthropic"

/**
 * Whether a request's model gets its signed reasoning replayed (#374, #386). The hook event exposes only the model's provider and id,
 * not its route or protocol, so the gate is on those: provider `anthropic`, and Copilot's Claude models (`github-copilot`, id `claude-*`).
 * Copilot serves a Claude model on the Anthropic messages route when it lists `/v1/messages`, and on chat completions or responses
 * otherwise. Neither of those reads the `anthropic` key (`src/github-copilot/chat` and `responses` in OpenCode v2.0.27), so the
 * signature is not sent there. Other Copilot models are not Claude and stay out.
 */
export function replaysSignedThinking(model: { readonly providerID: string; readonly id?: string } | undefined): boolean {
  if (model?.providerID === "anthropic") return true
  return model?.providerID === "github-copilot" && model.id?.startsWith("claude-") === true
}

/** A caller's signed reasoning as the host's reasoning part, which the Anthropic route lowers back to a signed `thinking` or `redacted_thinking` block. */
const reasoningOf = (item: ReasoningPart): HostPart => ({
  type: "reasoning",
  text: item.text,
  providerMetadata: { [ANTHROPIC_METADATA_KEY]: item.redactedData !== undefined ? { redactedData: item.redactedData } : { signature: item.signature } },
})

/**
 * Caller messages as host `Message` objects. Media placeholders are swapped in `applyContext`. Reasoning parts are kept only when
 * `replayReasoning` is set; a message left empty by that is dropped.
 */
function toHostMessages(messages: ReadonlyArray<PlugMessage>, replayReasoning: boolean): Array<{ role: string; content: HostPart[] }> {
  let image = 0
  const part = (item: PlugMessage["content"][number]): HostPart | undefined => {
    switch (item.type) {
      case "text":
        return item.cache ? { ...text(item.text), cache: hintOf(item.cacheTtl) } : text(item.text)
      case "media":
        return mediaPlaceholder(image++, item.cache, item.cacheTtl)
      case "tool-call":
        return { type: "tool-call", id: item.id, name: item.name, input: item.input }
      case "tool-result":
        return { type: "tool-result", id: item.id, name: item.name, result: { type: "text", value: item.result }, ...(item.cache ? { cache: hintOf(item.cacheTtl) } : {}) }
      case "reasoning":
        return replayReasoning ? reasoningOf(item) : undefined
    }
  }
  return messages
    .map((message) => ({
      role: message.role,
      content: message.content.flatMap((item) => {
        const host = part(item)
        return host ? [host] : []
      }),
    }))
    .filter((message) => message.content.length > 0)
}

function generationOptions(request: PlugRequest): Record<string, unknown> {
  const generation = request.generation
  const options: Record<string, unknown> = {}
  if (generation.maxTokens !== undefined) options.maxTokens = generation.maxTokens
  if (generation.temperature !== undefined) options.temperature = generation.temperature
  if (generation.topP !== undefined) options.topP = generation.topP
  if (generation.topK !== undefined) options.topK = generation.topK
  if (generation.seed !== undefined) options.seed = generation.seed
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
 * The app's `opencodeTools` (option `apps`) are kept as the host offered them: their descriptors were
 * never rewritten, so the host runs the real tool. Not offered when the caller set `tool_choice` none.
 *
 * The map is built with `Object.fromEntries`: a tool named `__proto__` becomes an own key like any
 * other instead of assigning the prototype and vanishing.
 */
function remapSeedTools(session: ContextHookEvent, request: PlugRequest, opencodeTools: ReadonlyArray<string>): number {
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
    for (const name of opencodeTools) {
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

/** Anthropic's breakpoint budget per request (OpenCode's `BREAKPOINT_CAP`, shared by its automatic placement). */
const BREAKPOINTS = 4

/**
 * Keeps every 1-hour breakpoint before every 5-minute one, on a request without tools (#275).
 *
 * Anthropic requires a 1h cache entry to come before any 5m entry. OpenCode adds 5m breakpoints by itself (its `AUTO` policy,
 * which runs because plugboard sends no cache policy): the first and last system part and the last text part of the last message.
 * The last-tool breakpoint is absent here, so the only ones this pass has to account for are those. Given a caller 1h block, the
 * pass gives 1h to every hinted part before the last 1h block (a 5m caller block there is raised too), and to the system first/last
 * and the tail part where those would otherwise take 5m before it, as far as the budget allows. Parts after the last 1h block keep
 * their 5m hint. With tools present every 1h hint is set back to the 5m default: OpenCode's last-tool 5m breakpoint comes before
 * every message, so a 1h block could not follow it (see docs/messages.md).
 *
 * Parts are replaced, never mutated: a host media object may be shared with the host's own prompt.
 */
function orderOneHourHints(session: ContextHookEvent): void {
  const system = (session.system ?? []) as HostPart[]
  const messages = (session.messages ?? []).map((message) => (Array.isArray(message.content) ? (message.content as HostPart[]) : []))
  // The wire order of the hinted positions: system, then messages (the tools slot is empty here).
  const slots: Array<{ list: HostPart[]; index: number }> = []
  for (const list of [system, ...messages]) list.forEach((_, index) => slots.push({ list, index }))
  const cacheOf = (index: number): { ttlSeconds?: number } | undefined => {
    const slot = slots[index]!
    return slot.list[slot.index]!.cache as { ttlSeconds?: number } | undefined
  }
  if (Object.keys(session.tools ?? {}).length > 0) {
    // Tools present: OpenCode's last-tool 5m breakpoint comes first, so every 1h hint is the 5m default.
    slots.forEach((_, index) => {
      if (cacheOf(index)?.ttlSeconds === ONE_HOUR) {
        const slot = slots[index]!
        slot.list[slot.index] = { ...slot.list[slot.index]!, cache: hint() }
      }
    })
    return
  }
  const last = slots.findLastIndex((_, index) => cacheOf(index)?.ttlSeconds === ONE_HOUR)
  if (last < 0) return
  const pin = (index: number) => {
    const slot = slots[index]!
    slot.list[slot.index] = { ...slot.list[slot.index]!, cache: hint(ONE_HOUR) }
  }
  const hinted = (index: number) => {
    const slot = slots[index]!
    return slot.list[slot.index]!.cache !== undefined
  }
  let budget = Math.max(0, BREAKPOINTS - slots.filter((_, index) => hinted(index)).length)
  for (let index = 0; index < last; index++) if (hinted(index)) pin(index)
  // OpenCode's own 5m candidates that come before `last`: the system first and last part, then the tail part. Each is a
  // slot index: system parts come first in `slots`, and the tail is the last text part of the last message (or its last part).
  // Known gap (not handled): the host can swap a part after this pass. The host's `replaceMedia` (OpenCode, packages/core/src/session/model-request.ts) replaces
  // media it cannot send, on a text-only model or above the image byte budget, with a hint-less text part. If that part is the
  // tail, AUTO hints it 5m after this pass, so a `[text, image A (replaced), image B (1h)]` tail gives 1h, 5m, 1h and Anthropic
  // rejects the order. It needs an Anthropic-protocol route with a text-only model or images over the budget. The request then
  // fails with Anthropic's order error. Covering it means pinning every part after the last text part before `last`.
  const lastContent = messages.at(-1) ?? []
  const tailOffset = lastContent.findLastIndex((part) => part.type === "text")
  const candidates: number[] = []
  if (system.length > 0) candidates.push(0)
  if (system.length > 1) candidates.push(system.length - 1)
  if (lastContent.length > 0) candidates.push(slots.length - lastContent.length + (tailOffset >= 0 ? tailOffset : lastContent.length - 1))
  for (const index of candidates) {
    if (index >= last || hinted(index) || budget === 0) continue
    pin(index)
    budget -= 1
  }
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
    if (media) return part.cache ? { ...media, cache: part.cache } : media
    missingMedia++
    return text("[image unavailable]")
  }

  session.system = requestSystem(request, state.prelude ?? [], policy).map(text)
  // Signed reasoning goes back only where `replaysSignedThinking` allows it; every other model gets the history without it.
  const replayReasoning = replaysSignedThinking(session.model)
  const caller = toHostMessages(request.messages, replayReasoning).map((message) => ({ ...message, content: message.content.map(swap) }))
  // A server-tool run (#417): the host reloads the session on every step, so its messages are the stored prompt, then the tool
  // calls and results of the steps before. The first call records how many the host had; a later call keeps the ones after
  // that index and puts them after the caller transcript. Only apps with opencodeTools continue this way.
  const host = session.messages ?? []
  let appended: typeof host = []
  if ((policy?.opencodeTools?.length ?? 0) > 0) {
    if (state.hostMessages === undefined) state.hostMessages = host.length
    else appended = host.slice(state.hostMessages)
  }
  session.messages = [...caller, ...appended]
  Object.assign(session.options ?? (session.options = {}), generationOptions(request))

  const missingTools = remapSeedTools(session, request, policy?.opencodeTools ?? [])
  orderOneHourHints(session)

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
