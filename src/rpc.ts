/**
 * The usage RPC, `opencode-plugboard.usage` (package entry `./rpc`): the report `GET /v1/usage` serves,
 * for OpenCode's own clients. A TUI plugin reads it with `client.rpc(UsageRpc).get({ ... })` over the
 * server's password-authenticated API, so the method sees every app.
 *
 * The server plugin registers the handler in every accepted generation (`index.ts`). Registration is
 * synchronous and touches no storage; the handler reads the same store as the route, from request
 * time only. Input and output are JSON Schema (the host's `Rpc.define`): the input is the query
 * (`from`, `to`, `app`, all optional), the output is the `UsageReport` as documented in `src/usage.ts`.
 * A bad query is the declared error `invalid_query` with `{ param }`, naming the parameter.
 */

import { Rpc } from "@opencode/plugin/rpc"
import type { RpcHandlers } from "@opencode/plugin/effect/rpc"
import { Effect } from "effect"
import { isPlugError, type PlugError } from "./contract.js"
import type { UsageQuery, UsageReport } from "./usage.js"

export const UsageRpc = Rpc.define({
  id: "opencode-plugboard.usage",
  methods: {
    get: {
      input: {
        type: "object",
        properties: {
          from: { type: "string", description: "First UTC day, YYYY-MM-DD. Default: 29 days before `to`." },
          to: { type: "string", description: "Last UTC day, YYYY-MM-DD. Default: today." },
          app: { type: "string", description: "One app name. Default: every app." },
          user: { type: "string", description: "One end user id. Each app's `users` then lists only that user. Default: every user." },
        },
        additionalProperties: false,
      },
      output: {
        type: "object",
        description: "A UsageReport (see src/usage.ts).",
        additionalProperties: true,
      },
      errors: {
        invalid_query: {
          type: "object",
          properties: { param: { type: "string", description: "The query parameter that is wrong: from, to, app or user." } },
          required: ["param"],
          additionalProperties: false,
        },
      },
    },
  },
  events: {},
})

/** The query fields of an RPC input. The input was validated against JSON Schema by the host; anything else is ignored. */
function queryOf(input: unknown): UsageQuery {
  const record: Record<string, unknown> = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {}
  const text = (value: unknown) => (typeof value === "string" ? value : undefined)
  return { from: text(record.from), to: text(record.to), app: text(record.app), user: text(record.user) }
}

/** The handlers for `UsageRpc`, reading the given usage query (the generation's recorder). */
export function usageHandlers(usage: { query(input: UsageQuery): Promise<UsageReport | PlugError> }): RpcHandlers<typeof UsageRpc> {
  return {
    get: (input, context) =>
      Effect.promise(() => usage.query(queryOf(input))).pipe(
        Effect.flatMap((result) => (isPlugError(result) ? Effect.fail(context.error("invalid_query", result.message, { param: result.param ?? "query" })) : Effect.succeed(result))),
      ),
  }
}
