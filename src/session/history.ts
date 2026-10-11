/**
 * Where request sessions live and what they store: the data root, the app directory, and the
 * session title and prompt transcript.
 *
 * One request = one kept OpenCode session in the caller app's directory under the data root.
 * The stored prompt is the full caller transcript rendered as readable text (images ride along
 * as prompt files, listed here by attachment number); the context hook substitutes the real
 * structured system/messages/tools for the model call.
 */

import { mkdir, realpath } from "node:fs/promises"
import { homedir } from "node:os"
import { join, sep } from "node:path"
import type { PlugError, PlugRequest } from "../contract.js"

/** `$XDG_DATA_HOME/opencode-plugboard`, else `~/.local/share/opencode-plugboard`. */
function dataRoot(): string {
  const base = process.env.XDG_DATA_HOME && process.env.XDG_DATA_HOME.length > 0 ? process.env.XDG_DATA_HOME : join(homedir(), ".local", "share")
  return join(base, "opencode-plugboard")
}

/**
 * Create (if needed) and return the real path of `<dataRoot>/<app>`. `app` must already be validated.
 * Fails closed with a `PlugError` when the resolved path is not strictly inside the canonical data
 * root (a symlinked app directory): a session there would run in another project, where plugboard
 * registers no context hook and no seeds, so it must never be created.
 *
 * This is the only place ownership of a directory is decided, and it is asynchronous: plugin
 * setup never touches the filesystem. A directory that comes back here is what the runtime treats
 * as a plugboard app directory (`ensureBackend` in src/runtime.ts).
 */
export async function ensureAppDir(app: string): Promise<string | PlugError> {
  const root = dataRoot()
  const appDir = join(root, app)
  await mkdir(appDir, { recursive: true })
  const [realRoot, realApp] = await Promise.all([realpath(root), realpath(appDir)])
  if (!realApp.startsWith(realRoot + sep)) {
    return { status: 500, kind: "server", code: "app_dir_outside_root", message: "The app directory resolves outside the plugboard data root" }
  }
  return realApp
}

const TITLE_LENGTH = 60

const firstUserText = (request: PlugRequest): string => {
  for (const message of request.messages) {
    if (message.role !== "user") continue
    for (const part of message.content) if (part.type === "text" && part.text.trim().length > 0) return part.text
  }
  return request.model
}

/** Session title: the first user text, whitespace-collapsed and cut to 60 characters. */
export const makeTitle = (request: PlugRequest): string => {
  const flat = firstUserText(request).replace(/\s+/g, " ").trim()
  return flat.length > TITLE_LENGTH ? flat.slice(0, TITLE_LENGTH - 1) + "…" : flat
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
