/**
 * Session backend (spec D6, D11, D15, D21).
 *
 * One request = one kept OpenCode session in the caller app's directory under the data root,
 * one model step. The stored prompt is the full caller transcript rendered as readable text
 * (images ride along as prompt files); `applyContext` (the app-directory `context` hook)
 * substitutes the real structured system/messages/tools for the model call.
 */

import { randomUUID } from "node:crypto"
import { mkdir, realpath } from "node:fs/promises"
import { realpathSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve, sep } from "node:path"
import { RequestCollector } from "./backend.js"
import { APP_NAME_PATTERN, DEFAULT_APP, type CallContext, type ModelCaller, type PlugEvent, type PlugMessage, type PlugRequest } from "./contract.js"
import { getRegistry, type RequestState } from "./registry.js"
import { SEED_PREFIX } from "./seeds.js"

type AnyRecord = Record<string, any>

// ---------------------------------------------------------------- data root (R15)

/** `$XDG_DATA_HOME/opencode-plugboard`, else `~/.local/share/opencode-plugboard`. */
export function dataRoot(): string {
  const base = process.env.XDG_DATA_HOME && process.env.XDG_DATA_HOME.length > 0 ? process.env.XDG_DATA_HOME : join(homedir(), ".local", "share")
  return join(base, "opencode-plugboard")
}

/** realpath of the deepest existing ancestor plus the not-yet-existing tail. */
function realpathLoose(path: string): string {
  let current = resolve(path)
  const tail: string[] = []
  while (true) {
    try {
      return join(realpathSync(current), ...tail.reverse())
    } catch {
      const parent = resolve(current, "..")
      if (parent === current) return resolve(path)
      tail.push(current.slice(parent.length + 1))
      current = parent
    }
  }
}

/** True when `directory` is the data root or below it, compared by realpath (D17, R15). */
export function isInsideDataRoot(directory: string): boolean {
  const root = realpathLoose(dataRoot())
  const dir = realpathLoose(directory)
  return dir === root || dir.startsWith(root + sep)
}

// ---------------------------------------------------------------- session port

/** Promise-shaped view of the host calls this backend needs (the entry wires them to `ctx.session`). */
export interface SessionPort {
  create(input: {
    readonly directory: string
    readonly model: { readonly providerID: string; readonly id: string; readonly variant?: string }
    readonly title: string
    readonly metadata: Record<string, unknown>
    readonly permissions: ReadonlyArray<{ action: string; resource: string; effect: "allow" | "deny" }>
  }): Promise<{ id: string }>
  prompt(input: { readonly sessionID: string; readonly text: string; readonly files: ReadonlyArray<{ uri: string; name: string }> }): Promise<unknown>
  interrupt(sessionID: string): Promise<void>
}

export interface SessionCallerDeps {
  readonly port: SessionPort
}

const TITLE_LENGTH = 60

const firstUserText = (request: PlugRequest): string => {
  for (const message of request.messages) {
    if (message.role !== "user") continue
    for (const part of message.content) if (part.type === "text" && part.text.trim().length > 0) return part.text
  }
  return request.model
}

const makeTitle = (request: PlugRequest): string => {
  const flat = firstUserText(request).replace(/\s+/g, " ").trim()
  return flat.length > TITLE_LENGTH ? flat.slice(0, TITLE_LENGTH - 1) + "…" : flat
}

// ---------------------------------------------------------------- transcript (D21)

const MAX_REMOTE_IMAGE_BYTES = 20 * 1024 * 1024

/** Prompt files must be inline data: URLs; fetch http(s) images once so the host can build assets. */
async function toDataUrl(url: string, signal: AbortSignal): Promise<string> {
  if (url.startsWith("data:")) return url
  if (!/^https?:\/\//i.test(url)) throw new Error(`Unsupported image URL scheme: ${url.slice(0, 32)}`)
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) })
  if (!response.ok) throw new Error(`Could not fetch image (${response.status}): ${url.slice(0, 120)}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_REMOTE_IMAGE_BYTES) throw new Error("Image is larger than 20 MB")
  const mediaType = response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream"
  return `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`
}

/** Readable transcript stored as the session's prompt; images are listed by attachment number. */
export function renderTranscript(request: PlugRequest): string {
  const lines: string[] = []
  let image = 0
  if (request.system.length > 0) {
    lines.push("## system", ...request.system, "")
  }
  for (const message of request.messages) {
    lines.push(`## ${message.role}`)
    for (const part of message.content) {
      switch (part.type) {
        case "text":
          lines.push(part.text)
          break
        case "media":
          lines.push(`[image ${++image}]`)
          break
        case "tool-call":
          lines.push(`[tool call ${part.name} (${part.id})] ${typeof part.input === "string" ? part.input : JSON.stringify(part.input)}`)
          break
        case "tool-result":
          lines.push(`[tool result ${part.name} (${part.id})${part.isError ? " (error)" : ""}] ${part.result}`)
          break
      }
    }
    lines.push("")
  }
  if (request.tools.length > 0) lines.push("## tools", request.tools.map((tool) => tool.name).join(", "), "")
  const text = lines.join("\n").trim()
  return text.length > 0 ? text : "(empty request)"
}

// ---------------------------------------------------------------- context hook

const text = (value: string) => ({ type: "text", text: value })

/** Caller messages as host `Message` objects. Media placeholders are swapped in `applyContext`. */
function toHostMessages(messages: ReadonlyArray<PlugMessage>): AnyRecord[] {
  let image = 0
  const part = (item: PlugMessage["content"][number]): AnyRecord => {
    switch (item.type) {
      case "text":
        return text(item.text)
      case "media":
        return { type: "media", __attachment: image++ }
      case "tool-call":
        return { type: "tool-call", id: item.id, name: item.name, input: item.input }
      case "tool-result":
        return { type: "tool-result", id: item.id, name: item.name, result: { type: "text", value: item.result } }
    }
  }
  return messages.map((message) => ({ role: message.role, content: message.content.map(part) }))
}

function generationOptions(request: PlugRequest): AnyRecord {
  const generation = request.generation
  const options: AnyRecord = {}
  if (generation.maxTokens !== undefined) options.maxTokens = generation.maxTokens
  if (generation.temperature !== undefined) options.temperature = generation.temperature
  if (generation.topP !== undefined) options.topP = generation.topP
  if (generation.stop !== undefined) options.stop = [...generation.stop]
  if (generation.presencePenalty !== undefined) options.presencePenalty = generation.presencePenalty
  if (generation.frequencyPenalty !== undefined) options.frequencyPenalty = generation.frequencyPenalty
  return options
}

/**
 * `session.hook("context")` body: swap the request session's system, messages, tools and
 * generation options for the caller's. Sessions that are not plugboard requests are untouched.
 */
export function applyContext(event: unknown): void {
  const session = event as AnyRecord
  const state: RequestState | undefined = getRegistry().requests.get(String(session.sessionID))
  if (!state) return
  const { request } = state

  // Swap media placeholders for the Asset-carrying parts the host built from the prompt files.
  const hostMedia = ((session.messages ?? []) as AnyRecord[])
    .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
    .filter((part: AnyRecord) => part?.type === "media")
  const swap = (part: AnyRecord) => (typeof part.__attachment === "number" ? (hostMedia[part.__attachment] ?? text("[image unavailable]")) : part)

  const system = request.system.map(text)
  // The OpenCode session API has no tool-choice control, so a forced or required tool is steered by instruction.
  const choice = request.toolChoice
  if (choice === "required") system.push(text("You must respond by calling one of the provided tools."))
  if (typeof choice === "object") system.push(text(`You must respond by calling the \`${choice.name}\` tool.`))
  session.system = system
  session.messages = toHostMessages(request.messages).map((message) => ({ ...message, content: message.content.map(swap) }))
  Object.assign(session.options ?? (session.options = {}), generationOptions(request))

  // Re-key the registered seed tools onto the caller's tool names.
  const seeds = Object.entries(session.tools ?? {}).filter(([name]) => name.startsWith(SEED_PREFIX))
  const tools = choice === "none" ? [] : typeof choice === "object" ? request.tools.filter((tool) => tool.name === choice.name) : request.tools
  const next: AnyRecord = {}
  let index = 0
  for (const tool of tools) {
    const seed = seeds[index++]
    if (!seed) break
    const descriptor = seed[1] as { description: string; input: unknown }
    descriptor.description = tool.description
    descriptor.input = tool.parameters
    next[tool.name] = descriptor
  }
  session.tools = next
}

// ---------------------------------------------------------------- ModelCaller

const failure = (status: number, message: string, code: string): PlugEvent => ({
  type: "error",
  error: { status, type: status >= 500 ? "server_error" : "invalid_request_error", message, code },
})

const describe = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message
  const text = String(error)
  return text.length > 400 ? text.slice(0, 400) + "…" : text
}

export function createSessionCaller(deps: SessionCallerDeps): ModelCaller {
  const { port } = deps
  const registry = getRegistry()

  return {
    async *stream(request: PlugRequest, context: CallContext): AsyncGenerator<PlugEvent> {
      const app = APP_NAME_PATTERN.test(context.app) || context.app === DEFAULT_APP ? context.app : undefined
      if (!app) return yield failure(400, `Invalid app name: ${context.app}`, "invalid_app")
      if (context.signal.aborted) return

      const requestID = randomUUID()
      let sessionID: string | undefined
      let collector: RequestCollector | undefined
      const interrupt = () => {
        if (sessionID) void port.interrupt(sessionID).catch(() => {})
      }
      const onAbort = () => {
        if (collector) collector.cancelled = true
        interrupt()
        collector?.end()
      }

      try {
        // 1. Prompt files: images become data URLs (http(s) ones are fetched once).
        const images: Array<{ uri: string; name: string }> = []
        for (const message of request.messages)
          for (const part of message.content)
            if (part.type === "media") images.push({ uri: await toDataUrl(part.url, context.signal), name: `image-${images.length + 1}` })

        // 2. The app directory under the data root; one top-level session per request (D15).
        const appDir = join(dataRoot(), app)
        await mkdir(appDir, { recursive: true })
        const directory = await realpath(appDir)

        collector = new RequestCollector({ stopTurn: interrupt })
        const created = await port.create({
          directory,
          model: { providerID: request.ref.providerID, id: request.ref.id, ...(request.ref.variant ? { variant: request.ref.variant } : {}) },
          title: makeTitle(request),
          metadata: { plugboard: { app, model: request.model, requestID } },
          permissions: [{ action: `${SEED_PREFIX}*`, resource: "*", effect: "allow" }],
        })
        sessionID = String(created.id)
        registry.requests.set(sessionID, { sessionID, app, requestID, request, images, collector })

        context.signal.addEventListener("abort", onAbort, { once: true })
        if (context.signal.aborted) return onAbort()

        // 3. Prompt concurrently; events stream through the collector while it runs.
        const owned = collector
        void port
          .prompt({ sessionID, text: renderTranscript(request), files: images })
          .catch((error) => {
            if (owned.terminal) return
            owned.push({ type: "session.execution.failed", error: { type: "prompt_failed", message: describe(error) } })
          })

        for await (const event of collector.queue) yield event
      } catch (error) {
        if (!context.signal.aborted) yield failure(502, `plugboard session backend failed: ${describe(error)}`, "backend_failed")
      } finally {
        context.signal.removeEventListener("abort", onAbort)
        if (sessionID) {
          registry.requests.delete(sessionID)
          // Anything still running (consumer left early, error, timeout) is interrupted; a finished turn is left alone.
          if (collector && !collector.terminal) {
            collector.cancelled = true
            collector.end()
            interrupt()
          }
        }
      }
    },
  }
}
