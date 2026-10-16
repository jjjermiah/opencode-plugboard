/**
 * #411 The model can name a tool in its reasoning by the placeholder id it was shown. The producer is
 * `@ex-machina/opencode-anthropic-auth` 2.0.0-next.x (read at 2.0.0-next.6, transform.js): a tool name
 * of 44 UTF-8 bytes or fewer becomes `mcp_T` plus base64url(name), a longer one `mcp_H` plus
 * base64url(sha256(name)), which cannot be reversed without the name. The 1.x line sends `mcp_` plus the
 * name with its first letter upper-cased. That id is internal, so reasoning text returned to the caller
 * says the tool's name instead.
 *
 * Only this request's own tools are aliased. An id is the whole run of id characters after `mcp_`, and
 * it is rewritten only when that exact run is one of the request's aliases. Text that merely looks like
 * an id (`mcp_servers`, `mcp_Tbm90`, `mcp_TZ2V0X3dlYXRoZXI_tool`) is left as it is.
 */
import { createHash } from "node:crypto"

/** The longest name (in UTF-8 bytes) the producer sends inline; a longer one is hashed. */
const SHORT_NAME_BYTES = 44

/** The ids this request's tool names are shown as, each mapped back to its name. */
export function placeholderAliases(names: Iterable<string>): Map<string, string> {
  const aliases = new Map<string, string>()
  for (const name of names) {
    const bytes = Buffer.from(name, "utf8")
    const id = bytes.length <= SHORT_NAME_BYTES ? `mcp_T${bytes.toString("base64url")}` : `mcp_H${createHash("sha256").update(bytes).digest("base64url")}`
    aliases.set(id, name)
    aliases.set(`mcp_${name.charAt(0).toUpperCase()}${name.slice(1)}`, name)
  }
  return aliases
}

/** The whole id run after `mcp_`; `mcp_` alone is not a run worth rewriting. */
const ID_RUN = /mcp_[A-Za-z0-9_-]*/g

/**
 * Streams text through the rewrite. `push` returns the text that is safe to emit now: an id run that might
 * still be growing, or a suffix that is the start of `mcp_`, waits in the buffer. `flush` returns what is
 * left at the end of a reasoning block or of the stream.
 */
export function placeholderRewriter(aliases: ReadonlyMap<string, string>) {
  let pending = ""
  const rewrite = (text: string) => text.replace(ID_RUN, (id) => aliases.get(id) ?? id)
  return {
    push(chunk: string): string {
      const text = pending + chunk
      // Only the trailing run of id characters can still become an id.
      const run = /[A-Za-z0-9_-]*$/.exec(text)![0]
      const base = text.length - run.length
      let cut = text.length
      for (let i = 0; i < run.length; i++) {
        const tail = run.slice(i)
        if (tail.startsWith("mcp_") || "mcp_".startsWith(tail)) {
          cut = base + i
          break
        }
      }
      pending = text.slice(cut)
      return rewrite(text.slice(0, cut))
    },
    flush(): string {
      const out = rewrite(pending)
      pending = ""
      return out
    },
  }
}
