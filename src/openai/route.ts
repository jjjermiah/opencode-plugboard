/**
 * OpenAI front-end route table: `GET /healthz`, `GET /v1/models`, `POST /v1/chat/completions`.
 *
 * The flow is: check origin, authenticate, parse, resolve the model, call the ModelCaller, encode.
 * Parsing, policy and encoding are imported directly; only effects (the model caller, the catalog
 * and the serving generation's options) arrive through `RouteHost`.
 */

import type { IncomingMessage, ServerResponse } from "node:http"
import { authenticate } from "../config.js"
import type { ModelCaller, PlugError, PlugEvent, PlugRequest, PlugboardOptions } from "../contract.js"
import { isPlugError } from "../errors.js"
import { BodyError, abortOnDisconnect, checkJsonContentType, checkOrigin, readJsonBody, sendJson, sseWriter, withTimeout } from "../http.js"
import { listAvailableModels, resolveModel, toCatalog } from "../models.js"
import { parseChatRequest } from "./request.js"
import { collectCompletion, encodeError, encodeModelList, streamCompletion } from "./response.js"

/** What the serving generation supplies per request. */
export interface RouteHost {
  readonly options: PlugboardOptions
  readonly caller: ModelCaller
  /** Raw `ctx.model.list` data from the serving Location. */
  loadCatalog(): Promise<unknown[]>
}

const KNOWN_ROUTES = ["GET /v1/models", "POST /v1/chat/completions"]

/**
 * Errors before any content are real HTTP errors, not a 200 SSE stream: pull events until the
 * first one that is not reasoning (which streaming drops anyway). Returns the error, or the stream
 * with that first event put back.
 */
async function peekStream(events: AsyncIterable<PlugEvent>): Promise<{ error: PlugError } | { events: AsyncIterable<PlugEvent> }> {
  const iterator = events[Symbol.asyncIterator]()
  let first = await iterator.next()
  while (!first.done && first.value.type === "reasoning-delta") first = await iterator.next()
  if (!first.done && first.value.type === "error") {
    void iterator.return?.(undefined)?.catch?.(() => {})
    return { error: first.value.error }
  }
  const lead = first
  return {
    events: {
      async *[Symbol.asyncIterator]() {
        try {
          if (!lead.done) yield lead.value
          while (true) {
            const next = await iterator.next()
            if (next.done) return
            yield next.value
          }
        } finally {
          void iterator.return?.(undefined)?.catch?.(() => {})
        }
      },
    },
  }
}

export function createOpenAiRoute(host: RouteHost) {
  const fail = (response: ServerResponse, error: PlugError) => sendJson(response, error.status, encodeError(error))

  return async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    const route = `${request.method} ${url.pathname}`
    try {
      const rejected = checkOrigin(request, host.options)
      if (rejected) return fail(response, rejected)

      if (route === "GET /healthz") return sendJson(response, 200, { ok: true })

      if (!KNOWN_ROUTES.includes(route)) {
        return fail(response, {
          status: 404,
          type: "not_found_error",
          code: "not_found",
          message: `No route for ${request.method} ${url.pathname}`,
        })
      }

      const auth = authenticate(host.options, request.headers.authorization)
      if (isPlugError(auth)) return fail(response, auth)

      if (route === "GET /v1/models") {
        const catalog = toCatalog(await host.loadCatalog())
        return sendJson(response, 200, encodeModelList(listAvailableModels(host.options, catalog)))
      }

      const unsupported = checkJsonContentType(request)
      if (unsupported) return fail(response, unsupported)

      const body = await readJsonBody(request)
      const parsed = parseChatRequest(body, host.options)
      if (isPlugError(parsed)) return fail(response, parsed)
      const catalog = toCatalog(await host.loadCatalog())
      const ref = resolveModel(host.options, parsed.request.model, catalog, parsed.reasoningEffort)
      if (isPlugError(ref)) return fail(response, ref)
      const plug: PlugRequest = { ...parsed.request, includeUsage: parsed.includeUsage, ref }

      const controller = abortOnDisconnect(response)
      const events = withTimeout(host.caller.stream(plug, { app: auth.app, signal: controller.signal }), host.options.requestTimeoutMs, controller)

      if (plug.stream) {
        const peeked = await peekStream(events)
        if ("error" in peeked) return fail(response, peeked.error)
        const sse = sseWriter(response)
        await streamCompletion(peeked.events, plug, sse.write, { includeUsage: plug.includeUsage })
        if (!sse.started && !response.headersSent) sendJson(response, 502, encodeError({ status: 502, type: "server_error", message: "No response from the model" }))
        else if (!response.writableEnded) response.end()
        return
      }

      const result = await collectCompletion(events, plug)
      sendJson(response, result.status, result.body)
    } catch (error) {
      if (error instanceof BodyError) return fail(response, { status: error.status, type: "invalid_request_error", message: error.message })
      const message = error instanceof Error ? error.message : String(error)
      console.error("[opencode-plugboard] request failed", error)
      if (response.headersSent) return void response.end()
      fail(response, { status: 500, type: "server_error", message })
    }
  }
}
