# Errors on plugboard's own routes

Plugboard's own routes live under `/plugboard/`: `/plugboard/usage`, `/plugboard/admin/keys`, `/plugboard/status`, `/plugboard/metrics`, `/plugboard/dashboard`, `/plugboard/health` and `/plugboard/ready`. Their errors are [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem details, sent as `application/problem+json`:

```json
{
  "type": "https://jjjermiah.github.io/opencode-plugboard/errors#app-forbidden",
  "title": "Forbidden",
  "status": 403,
  "detail": "This key cannot read the usage of another app",
  "instance": "/plugboard/usage?app=sparkyfitness",
  "code": "app_forbidden",
  "param": "app",
  "requestId": "3f9c1a0d2b7e"
}
```

- `type` links to the anchor for the `code` below. A code with no anchor here is `about:blank`.
- `title` is the HTTP reason phrase for `status`. `detail` is the message for this request: safe to show. It never holds a key or provider text.
- `instance` is the request target as sent (path and query).
- `code` is the machine-readable reason, `param` the request field it is about (when there is one), and `requestId` the value of the `x-plugboard-request-id` response header, which the server log also carries.
- Headers keep their meaning: `Retry-After` on a refusal that can be retried.

The model routes are different. `/v1/chat/completions`, `/v1/responses`, `/v1/completions`, `/v1/models`, `/v1/messages` and `/v1beta/*` answer errors in their provider's shape (OpenAI, Anthropic or Gemini), so SDKs keep their own exception types.

The root probes `/healthz` and `/readyz` keep their own bodies (`{"ok":true}`, `{"ready":...}`).

## Codes

### invalid_request_target {#invalid-request-target}

The request target is not a valid URL. Fix the client's URL.

### invalid_host {#invalid-host}

The `Host` header is not the listen address. Plugboard refuses DNS rebinding on loopback. Call the address in `listen` (`127.0.0.1:4010` by default).

### cross_origin_forbidden {#cross-origin-forbidden}

A browser `Origin` header reached a keyless endpoint. Configure `keys`, or call plugboard from a server or a command line tool.

### unsupported_media_type {#unsupported-media-type}

The request body must be `Content-Type: application/json`.

### invalid_api_key {#invalid-api-key}

The key is missing or does not match any configured or runtime key. Send `Authorization: Bearer <key>` with a key from `keys`, or a runtime key from the admin routes.

### admin_key_required {#admin-key-required}

`/plugboard/metrics` with `adminKey` set reads the admin key only, because its series name every app. Send the admin key.

### not_found {#not-found}

No plugboard route at this path, or the option that serves it is off (for example `/plugboard/usage` with `usage: { enabled: false }`). The discovery page at `/` lists the routes that are served. Old paths such as `/v1/usage`, `/v1/status` and `/metrics` are not served any more: see the breaking change in the changelog.

### method_not_allowed {#method-not-allowed}

The path exists but not for this method (for example `PUT /plugboard/admin/keys`). Use the method the discovery page lists.

### invalid_date {#invalid-date}

A `from` or `to` value is not a UTC date in `YYYY-MM-DD` form, or is not a real date. The `param` names which one.

### invalid_range {#invalid-range}

`from` is after `to`. Swap them.

### range_too_long {#range-too-long}

The range spans more than 366 days. Ask for a shorter range, or fetch it in parts.

### invalid_app {#invalid-app}

The `app` value is not an app name from the `keys` configuration (for `/plugboard/usage`), or not a valid runtime key name (`/plugboard/admin/keys`: lowercase letters, digits and `-`, and not `default`).

### invalid_user {#invalid-user}

The `user` filter is not 1 to 64 characters of `A-Z`, `a-z`, `0-9`, `.`, `_`, `@`, `:` or `-`.

### app_forbidden {#app-forbidden}

An app key asked for the usage of another app. An app key reads only its own app; the admin key reads any app.

### key_not_found {#key-not-found}

No runtime key has that id. List the keys at `GET /plugboard/admin/keys` to find the right one.

### config_key {#config-key}

The key is in the plugboard config (`keys`), so the admin routes cannot revoke it. Remove it there and reload OpenCode.

### app_has_server_tools {#app-has-server-tools}

The app runs OpenCode tools (`apps.<name>.serverTools`), and a runtime key would give the same power. Set its key in the plugboard config instead.

### app_has_config_key {#app-has-config-key}

The app already has a key in the plugboard config. Edit `keys` to change it, or pick another app name.

### not_ready {#not-ready}

The backend cannot serve yet. The `detail` names the first missing piece: no generation, no app directory used since start, the event pump not running, or the model catalog not loaded. Send one model request to an app to confirm the directory; the other pieces follow on their own. The same reason is in the `/readyz` document.

### body_read_timeout {#body-read-timeout}

The request body did not arrive within `limits.bodyReadTimeoutMs`. Send the body without a pause.

### request_body_too_large {#request-body-too-large}

The request body is over the body cap: `limits.maxBodyBytes` (32 MiB by default), or the app's `limits.apps.<name>.maxBodyBytes`. Send a smaller body, or ask the operator to raise the cap. Before 0.31.0 this 413 had no code.

### server_busy {#server-busy}

Too many request bodies are being read at once (`limits.maxBodyBytesInFlight`). Retry after the `Retry-After` delay.

### timeout {#timeout}

The request ran past `requestTimeoutMs`. Raise that option, or ask for less work per request.
