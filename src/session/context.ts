/**
 * Context hook and seed tools: what plugboard installs inside the app directories, and what the
 * `session.hook("context")` hook does for a plugboard request session.
 *
 * The stored prompt is only a readable transcript. The hook swaps in the caller's real
 * structured system, messages, tool definitions and generation options. Sessions that are not
 * plugboard requests (not in the process-wide session store) are untouched.
 */

import { Effect } from "effect"
import type { PlugError, PlugMessage, PlugRequest } from "../contract.js"
import type { ContextHookEvent, HostContext, HostPart } from "./host.js"
import { SEED_PREFIX, SEED_RESULT, seedToolsFor } from "./seeds.js"
import { FAILURE_EVENT, type SessionStore } from "./state.js"

const text = (value: string): HostPart => ({ type: "text", text: value })

/** Placeholder for a caller image; swapped for the host-built media part in `applyContext`. */
const mediaPlaceholder = (index: number): HostPart => ({ type: "media", __attachment: index })

/** Caller messages as host `Message` objects. Media placeholders are swapped in `applyContext`. */
function toHostMessages(messages: ReadonlyArray<PlugMessage>): Array<{ role: string; content: HostPart[] }> {
  let image = 0
  const part = (item: PlugMessage["content"][number]): HostPart => {
    switch (item.type) {
      case "text":
        return text(item.text)
      case "media":
        return mediaPlaceholder(image++)
      case "tool-call":
        return { type: "tool-call", id: item.id, name: item.name, input: item.input }
      case "tool-result":
        return { type: "tool-result", id: item.id, name: item.name, result: { type: "text", value: item.result } }
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
 * Returns how many caller tools got no seed (zero unless the seed pool is smaller than the request needs).
 */
function remapSeedTools(session: ContextHookEvent, request: PlugRequest): number {
  const seeds = Object.entries(session.tools ?? {}).filter(([name]) => name.startsWith(SEED_PREFIX))
  const tools = seedToolsFor(request)
  const next: NonNullable<ContextHookEvent["tools"]> = {}
  let index = 0
  for (const tool of tools) {
    const seed = seeds[index]
    if (!seed) break
    index++
    const descriptor = seed[1]
    descriptor.description = tool.description
    descriptor.input = tool.parameters
    next[tool.name] = descriptor
  }
  session.tools = next
  return tools.length - index
}

const preparationFailed = (message: string): PlugError => ({ status: 500, kind: "server", code: "backend_preparation_failed", message })

/**
 * `session.hook("context")` body: swap the request session's system, messages, tools and
 * generation options for the caller's.
 */
function applyContext(event: unknown, sessions: SessionStore): void {
  // Assumed invariant: the host passes its mutable `SessionContext` (checked structurally by `HostContextMatches`).
  const session = event as ContextHookEvent
  const state = sessions.lookup(String(session.sessionID))
  if (!state) return
  const { request } = state

  // Swap media placeholders for the Asset-carrying parts the host built from the prompt files.
  const hostMedia = (session.messages ?? [])
    .flatMap((message) => (Array.isArray(message.content) ? (message.content as unknown[]) : []))
    .filter((part) => (part as HostPart | undefined)?.type === "media")
  let missingMedia = 0
  const swap = (part: HostPart) => {
    if (typeof part.__attachment !== "number") return part
    const media = hostMedia[part.__attachment]
    if (media) return media
    missingMedia++
    return text("[image unavailable]")
  }

  const system = request.system.map(text)
  // The OpenCode session API has no tool-choice control, so a forced or required tool is steered by instruction.
  const choice = request.toolChoice
  if (choice === "required") system.push(text("You must respond by calling one of the provided tools."))
  if (typeof choice === "object") system.push(text(`You must respond by calling the \`${choice.name}\` tool.`))
  session.system = system
  session.messages = toHostMessages(request.messages).map((message) => ({ ...message, content: message.content.map(swap) }))
  Object.assign(session.options ?? (session.options = {}), generationOptions(request))

  const missingTools = remapSeedTools(session, request)

  // The caller validates both before dispatch; this only fires if the host disagrees. The request is
  // already rewritten (no real tool can run); fail it instead of answering from a truncated prompt.
  if (missingMedia > 0 || missingTools > 0) {
    const detail = [missingMedia > 0 ? `${missingMedia} attachment(s) not delivered by the host` : "", missingTools > 0 ? `${missingTools} tool(s) without a seed tool` : ""]
    state.collector.push({
      type: FAILURE_EVENT,
      error: preparationFailed(`Could not prepare the model request: ${detail.filter(Boolean).join(", ")}`),
    })
  }
}

/**
 * Registrations for a Location inside the plugboard data root: the context hook, the agent
 * deny for the seeds, and the seed tool pool.
 *
 * Every agent denies the seeds; request sessions are created with a session permission that
 * allows them again, so a person prompting inside an app directory is never offered them.
 * Registration only: no host call that waits on readiness (see docs/architecture.md).
 */
export function installSessionHooks(ctx: HostContext, options: { readonly maxTools: number; readonly sessions: SessionStore }) {
  return Effect.gen(function* () {
    // Swap in the caller's system/messages/tools for plugboard request sessions only.
    yield* ctx.session.hook("context", (event) => Effect.sync(() => applyContext(event, options.sessions)))

    yield* ctx.agent.transform((editor) => {
      for (const agent of editor.list()) {
        editor.update(agent.id, (item) => {
          item.permissions.push({ action: `${SEED_PREFIX}*`, resource: "*", effect: "deny" })
        })
      }
    })
    yield* ctx.tool.transform((editor) => {
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
