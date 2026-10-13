/**
 * The Open WebUI connection the scenarios share. `base` is the port Docker published on this machine; `upstream` is
 * the plugboard `/v1` address as the container sees it (host.docker.internal), for connection tests. The token comes
 * from signin: with WEBUI_AUTH=False the default admin signs in with any password.
 */
export interface Owui {
  readonly base: string
  readonly token: string
  readonly upstream: string
}

/** One call to the Open WebUI API. The status and the parsed body come back whatever they are: the scenarios check them. */
export async function call(owui: Owui, method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown; text: string }> {
  const response = await fetch(`${owui.base}${path}`, {
    method,
    headers: { authorization: `Bearer ${owui.token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  return { status: response.status, json, text }
}

/** Reads a path out of a parsed body, or undefined. */
export function at(value: unknown, ...keys: Array<string | number>): unknown {
  return keys.reduce<unknown>((node, key) => (node !== null && typeof node === "object" ? (node as Record<string | number, unknown>)[key] : undefined), value)
}
