/**
 * #411 The model sometimes names a tool in its reasoning by the placeholder id it was shown:
 * `mcp_` plus `T` plus the base64url of the tool's name (`mcp_TZ2V0X3dlYXRoZXI` is `get_weather`).
 * The id is an internal encoding, so reasoning text returned to the caller says the name instead.
 *
 * Only an id that decodes to a plain tool name is rewritten. Anything else that starts with `mcp_`
 * (`mcp_servers`, a half id) is left as it is.
 */

const PLACEHOLDER = /mcp_[A-Za-z0-9_-]+/g
const NAME = /^[A-Za-z0-9_.:-]{1,128}$/

/** The caller's tool name an id encodes, or undefined when the id does not encode one. */
export function toolNameOf(id: string): string | undefined {
  const body = id.startsWith("mcp_") ? id.slice(4) : ""
  // The encoding's leading `T` is stripped first; an id without it is tried as the bare base64url too.
  for (const candidate of body.startsWith("T") ? [body.slice(1), body] : [body]) {
    if (candidate.length === 0 || !/^[A-Za-z0-9_-]+$/.test(candidate)) continue
    const name = Buffer.from(candidate, "base64url").toString("utf8")
    // Canonical base64url only: re-encoding the name gives back the id, so a random word does not match.
    if (Buffer.from(name, "utf8").toString("base64url") === candidate && NAME.test(name)) return name
  }
  return undefined
}

/**
 * Streams text through the rewrite. `push` returns the text that is safe to emit now; an id that
 * might still be growing (or a prefix of `mcp_`) waits in the buffer. `flush` returns what is left at
 * the end of a reasoning block or of the stream.
 */
export function placeholderRewriter() {
  let pending = ""
  const rewrite = (text: string) => text.replace(PLACEHOLDER, (id) => toolNameOf(id) ?? id)
  return {
    push(chunk: string): string {
      const text = pending + chunk
      // The trailing run of id characters is the only part that can still become an id.
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
