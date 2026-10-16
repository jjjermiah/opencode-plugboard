/**
 * Admin routes for runtime app keys (#55): `GET /plugboard/admin/keys` (keys without values),
 * `POST /plugboard/admin/keys` with body `{ "app": "<name>" }` (a new random key, returned once) and
 * `DELETE /plugboard/admin/keys/{keyId}` (revokes a runtime key; a config key is a 409). Errors are problem+json.
 *
 * The routes exist only when option `adminKey` is set: without it every path here is a 404. Only the
 * admin key passes; an app key, a wrong key or no key is a 401. src/openai/route.ts dispatches here
 * after the origin check and before app authentication, so an app key never reaches them.
 */

import type { IncomingMessage, ServerResponse } from "node:http"
import { APP_NAME_MAX, DEFAULT_APP, appPolicy, authenticateUsage, bodyApps, bodyLimits, bodyRequirement, isAppName, type PlugboardOptions } from "../config.js"
import { isPlugError, type PlugError } from "../contract.js"
import { checkJsonContentType, readJsonBody, sendJson, sendProblem, type RequestScope } from "../http.js"
import type { KeyStore } from "../keys.js"
import { logAudit } from "../log.js"

export interface AdminHost {
  /** The live options (`liveOptions`): the config keys, and `adminKey`. */
  readonly options: PlugboardOptions
  /** The runtime key store; absent means the admin routes are not served. */
  readonly keys?: KeyStore
}

export interface AdminCall {
  readonly path: string
  readonly request: IncomingMessage
  readonly response: ServerResponse
  readonly scope: RequestScope
  /** The route's log fields: the route name is set here, so the request log names the admin route. */
  readonly info: { route: string; app?: string }
}

const KEYS = "/plugboard/admin/keys"
const ONE_KEY = /^\/plugboard\/admin\/keys\/([0-9a-f]{8})$/

export async function serveAdmin(host: AdminHost, call: AdminCall): Promise<void> {
  const { path, request, response, scope, info } = call
  const fail = (error: PlugError) => sendProblem(response, error, request.url ?? path)
  const { keys } = host
  if (host.options.adminKey === undefined || keys === undefined)
    return fail({ status: 404, kind: "not_found", code: "not_found", message: `No route for ${request.method} ${path}` })

  const who = authenticateUsage(host.options, request.headers.authorization, await keys.digests())
  if (isPlugError(who) || !who.admin) return fail({ status: 401, kind: "authentication", code: "invalid_api_key", message: "Missing or invalid admin key" })

  const id = ONE_KEY.exec(path)?.[1]
  if (path === KEYS && request.method === "GET") {
    info.route = "GET /plugboard/admin/keys"
    return sendJson(response, 200, { keys: await keys.list(host.options.keys) })
  }
  if (path === KEYS && request.method === "POST") {
    info.route = "POST /plugboard/admin/keys"
    const unsupported = checkJsonContentType(request)
    if (unsupported) return fail(unsupported)
    const body = await readJsonBody(request, scope.signal, bodyLimits(host.options, undefined, keys.appNames()))
    const app = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as { app?: unknown }).app : undefined
    if (typeof app !== "string" || app === DEFAULT_APP || !isAppName(app))
      return fail({ status: 400, kind: "invalid_request", code: "invalid_app", param: "app", message: `\`app\` must be at most ${APP_NAME_MAX} characters, match the app name pattern, and not be \`${DEFAULT_APP}\`` })
    // A runtime key would carry the app's server tools (#197): those apps get their key from the config only.
    if (appPolicy(host.options, app)?.serverTools)
      return fail({ status: 409, kind: "invalid_request", code: "app_has_server_tools", param: "app", message: `App ${app} runs OpenCode tools (option \`apps.${app}.serverTools\`); a runtime key would give the same power, so none is minted. Set the key in the plugboard config` })
    if (Object.hasOwn(host.options.keys, app))
      return fail({ status: 409, kind: "invalid_request", code: "app_has_config_key", param: "app", message: `App ${app} already has a key in the plugboard config; edit \`keys\` to change it` })
    // An explicit body budget must still hold one body of its largest size per app, this one included (`bodyRequirement`). Unset, it grows.
    const runtimeApps = keys.appNames()
    const budget = host.options.limits?.maxBodyBytesInFlight
    if (budget !== undefined && !runtimeApps.includes(app)) {
      const need = bodyRequirement(host.options, bodyApps(host.options, [...runtimeApps, app]))
      if (need > budget)
        return fail({
          status: 409,
          kind: "invalid_request",
          code: "body_budget_insufficient",
          param: "app",
          message: `Adding app ${app} needs ${need} bytes of request-body budget (one largest body per app), but \`limits.maxBodyBytesInFlight\` is ${budget}. Raise it, or unset it to let it grow with the apps`,
        })
    }
    const created = await keys.create(app, host.options.keys)
    logAudit("admin.key_created", { id: created.id, app })
    // The key value is shown once: a cache or a log of this response must not keep it.
    response.setHeader("cache-control", "no-store")
    return sendJson(response, 201, created)
  }
  if (id !== undefined && request.method === "DELETE") {
    info.route = "DELETE /plugboard/admin/keys/{keyId}"
    const result = await keys.revoke(id, host.options.keys)
    if (result === "config")
      return fail({ status: 409, kind: "invalid_request", code: "config_key", message: "This key is set in the plugboard config (`keys`). Remove it there and reload OpenCode." })
    if (result === "not_found") return fail({ status: 404, kind: "not_found", code: "key_not_found", message: `No runtime key ${id}` })
    logAudit("admin.key_revoked", { id })
    return sendJson(response, 200, { id, revoked: true })
  }
  if (path === KEYS || id !== undefined)
    return fail({ status: 405, kind: "invalid_request", code: "method_not_allowed", message: `Method ${request.method} is not allowed for ${path}` })
  return fail({ status: 404, kind: "not_found", code: "not_found", message: `No route for ${request.method} ${path}` })
}
