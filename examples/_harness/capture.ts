/**
 * The capture proxy: a loopback reverse proxy between a client example and plugboard. It streams every response
 * through untouched and records each exchange, tagged with the scenario mark that was current when the request
 * started. Requests start after a mark and finish before the next one, so a slice by mark is one scenario.
 *
 * The runner marks a scenario with `POST <capture>/__mark` `{scenario, model}`. The mark waits until nothing is in
 * flight, so a late answer from the previous scenario cannot land in the next slice. Ported from compat/tools/logproxy.py
 * (which stays until the cleanup issue deletes it).
 */

export interface Mark {
  readonly scenario: string
  readonly model: string
  /** The API a scenario ran on, when one example runs it on several (curl). */
  readonly variant?: string
  readonly at: number
}

export interface Exchange {
  /** Request-start order, from 0. */
  readonly seq: number
  /** Index into `marks`, or -1 before the first mark. */
  readonly mark: number
  readonly method: string
  /** The request target as sent (path and query). */
  readonly path: string
  readonly reqHeaders: Readonly<Record<string, string>>
  readonly reqBody: string
  readonly status: number
  readonly resHeaders: Readonly<Record<string, string>>
  readonly resBody: string
  readonly durationMs: number
}

export interface Capture {
  /** The origin the runner calls, e.g. `http://127.0.0.1:53124`. */
  readonly url: string
  readonly marks: Mark[]
  /** Exchanges in request-start order. Complete once `close` resolves. */
  readonly exchanges: Exchange[]
  close(): Promise<void>
}

/** Headers that never cross a proxy, plus the ones the proxy must rewrite itself. */
const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "proxy-connection", "host", "content-length", "accept-encoding"])
const RESPONSE_DROP = new Set([...HOP, "content-encoding"])

export async function startCapture(upstream: string): Promise<Capture> {
  const origin = new URL(upstream)
  if (origin.protocol !== "http:") throw new Error(`capture upstream must be http:// (got ${upstream}); the proxy does not speak TLS`)

  const marks: Mark[] = []
  const exchanges: Exchange[] = []
  let inFlight = 0
  let seq = 0
  const pending = new Set<Promise<unknown>>()

  const settle = async () => {
    while (inFlight > 0) await new Promise((resolve) => setTimeout(resolve, 2))
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 255,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/__mark" && request.method === "POST") {
        const body = (await request.json()) as { scenario?: unknown; model?: unknown; variant?: unknown }
        if (typeof body.scenario !== "string" || typeof body.model !== "string") return new Response("mark needs scenario and model", { status: 400 })
        await settle()
        const variant = typeof body.variant === "string" ? body.variant : undefined
        marks.push({ scenario: body.scenario, model: body.model, ...(variant === undefined ? {} : { variant }), at: Date.now() })
        return new Response(null, { status: 204 })
      }
      inFlight++
      const start = Date.now()
      const mark = marks.length - 1
      const id = seq++
      const reqBody = await request.text()
      const reqHeaders = Object.fromEntries([...request.headers.entries()].filter(([name]) => !HOP.has(name)))
      const target = new URL(url.pathname + url.search, origin)
      try {
        const upstreamResponse = await fetch(target, {
          method: request.method,
          headers: reqHeaders,
          body: reqBody === "" ? undefined : reqBody,
          redirect: "manual",
        })
        const resHeaders = Object.fromEntries([...upstreamResponse.headers.entries()].filter(([name]) => !RESPONSE_DROP.has(name)))
        const [toClient, toRecord] = upstreamResponse.body ? upstreamResponse.body.tee() : [null, null]
        const recording = (async () => {
          const text = toRecord ? await new Response(toRecord).text() : ""
          exchanges.push({
            seq: id,
            mark,
            method: request.method,
            path: url.pathname + url.search,
            reqHeaders: Object.fromEntries(Object.entries(reqHeaders).map(([k, v]) => [k, String(v)])),
            reqBody,
            status: upstreamResponse.status,
            resHeaders: Object.fromEntries(Object.entries(resHeaders).map(([k, v]) => [k, String(v)])),
            resBody: text,
            durationMs: Date.now() - start,
          })
        })().finally(() => {
          inFlight--
        })
        pending.add(recording)
        void recording.finally(() => pending.delete(recording))
        return new Response(toClient, { status: upstreamResponse.status, headers: resHeaders })
      } catch (error) {
        inFlight--
        return new Response(`upstream error: ${error instanceof Error ? error.message : String(error)}`, { status: 502 })
      }
    },
  })

  return {
    url: `http://127.0.0.1:${server.port}`,
    marks,
    exchanges,
    async close() {
      await settle()
      await Promise.allSettled([...pending])
      exchanges.sort((a, b) => a.seq - b.seq)
      server.stop(true)
    },
  }
}
