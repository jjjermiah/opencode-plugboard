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
import { realpathSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join, resolve, sep } from "node:path"
import type { PlugRequest } from "../contract.js"

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
      tail.push(basename(current))
      current = parent
    }
  }
}

/** True when `directory` is the data root or below it, compared by realpath. */
export function isInsideDataRoot(directory: string): boolean {
  const root = realpathLoose(dataRoot())
  const dir = realpathLoose(directory)
  return dir === root || dir.startsWith(root + sep)
}

/** Create (if needed) and return the real path of `<dataRoot>/<app>`. `app` must already be validated. */
export async function ensureAppDir(app: string): Promise<string> {
  const appDir = join(dataRoot(), app)
  await mkdir(appDir, { recursive: true })
  return realpath(appDir)
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
