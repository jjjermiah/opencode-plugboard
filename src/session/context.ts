/**
 * Context hook application: what `session.hook("context")` does for a plugboard request session.
 *
 * The stored prompt is only a readable transcript. Here the hook swaps in the caller's real
 * structured system, messages, tool definitions and generation options. Sessions that are not
 * plugboard requests (not in the process-wide registry) are untouched.
 */

import type { PlugMessage, PlugRequest } from "../contract.js"
import { getRegistry } from "../registry.js"
import type { ContextHookEvent, HostPart } from "./host.js"
import { SEED_PREFIX } from "./seeds.js"

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
 */
function remapSeedTools(session: ContextHookEvent, request: PlugRequest): void {
  const choice = request.toolChoice
  const seeds = Object.entries(session.tools ?? {}).filter(([name]) => name.startsWith(SEED_PREFIX))
  const tools = choice === "none" ? [] : typeof choice === "object" ? request.tools.filter((tool) => tool.name === choice.name) : request.tools
  const next: NonNullable<ContextHookEvent["tools"]> = {}
  let index = 0
  for (const tool of tools) {
    const seed = seeds[index++]
    if (!seed) break
    const descriptor = seed[1]
    descriptor.description = tool.description
    descriptor.input = tool.parameters
    next[tool.name] = descriptor
  }
  session.tools = next
}

/**
 * `session.hook("context")` body: swap the request session's system, messages, tools and
 * generation options for the caller's.
 */
export function applyContext(event: unknown): void {
  // Assumed invariant: the host passes its mutable `SessionContext` (checked structurally by `HostContextMatches`).
  const session = event as ContextHookEvent
  const state = getRegistry().requests.get(String(session.sessionID))
  if (!state) return
  const { request } = state

  // Swap media placeholders for the Asset-carrying parts the host built from the prompt files.
  const hostMedia = (session.messages ?? [])
    .flatMap((message) => (Array.isArray(message.content) ? (message.content as unknown[]) : []))
    .filter((part) => (part as HostPart | undefined)?.type === "media")
  const swap = (part: HostPart) => (typeof part.__attachment === "number" ? (hostMedia[part.__attachment] ?? text("[image unavailable]")) : part)

  const system = request.system.map(text)
  // The OpenCode session API has no tool-choice control, so a forced or required tool is steered by instruction.
  const choice = request.toolChoice
  if (choice === "required") system.push(text("You must respond by calling one of the provided tools."))
  if (typeof choice === "object") system.push(text(`You must respond by calling the \`${choice.name}\` tool.`))
  session.system = system
  session.messages = toHostMessages(request.messages).map((message) => ({ ...message, content: message.content.map(swap) }))
  Object.assign(session.options ?? (session.options = {}), generationOptions(request))

  remapSeedTools(session, request)
}
