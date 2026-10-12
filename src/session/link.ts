/**
 * Links from a response to the OpenCode session page of its request (#77). The host exposes no UI URL
 * to a plugin, so option `historyUrl` is a template the operator fills in for how they reach OpenCode:
 * `{id}` is the session id, `{directory}` the app directory (URL-encoded). With the option set, a
 * response that carries `x-plugboard-session` also carries `x-plugboard-session-url` with the filled
 * link, and the request log line gains `session_url=`.
 *
 * Pure: no node imports. The routes call `setSessionLink` from their `onRecord` callback, after they
 * set the session header, so a link is only ever sent for a session that was named.
 */

export const SESSION_URL_HEADER = "x-plugboard-session-url"

/** The template with `{id}` and `{directory}` filled (both URL-encoded). */
export function sessionUrl(template: string, recordID: string, directory = ""): string {
  return template.replaceAll("{id}", encodeURIComponent(recordID)).replaceAll("{directory}", encodeURIComponent(directory))
}

/**
 * Sets `x-plugboard-session-url` for one history record and the log field, when a template is set.
 * Nothing happens without a template, so a route calls this unconditionally.
 */
export function setSessionLink(
  response: { setHeader(name: string, value: string): unknown },
  info: { sessionUrl?: string },
  template: string | undefined,
  recordID: string,
  directory?: string,
): void {
  if (template === undefined) return
  info.sessionUrl = sessionUrl(template, recordID, directory)
  response.setHeader(SESSION_URL_HEADER, info.sessionUrl)
}
