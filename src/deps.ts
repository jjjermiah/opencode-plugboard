/** Wires the OpenAI Chat Completions front-end and the config/model core into the router. */

import { authenticate, parseOptions } from "./config.js"
import { listModels, resolveModel, toCatalog } from "./models.js"
import { parseChatRequest } from "./openai/request.js"
import { collectCompletion, encodeError, streamCompletion } from "./openai/response.js"
import type { RouteDeps } from "./server.js"

export const deps: RouteDeps = {
  parseOptions,
  authenticate,
  toCatalog,
  resolveModel,
  listModels,
  parseChatRequest: (body, options) => {
    const parsed = parseChatRequest(body, options)
    if (!("request" in parsed)) return parsed
    return { request: { ...parsed.request, includeUsage: parsed.includeUsage }, reasoningEffort: parsed.reasoningEffort }
  },
  collectCompletion,
  streamCompletion: (events, request, write) => streamCompletion(events, request, write, { includeUsage: request.includeUsage }),
  encodeError,
}
