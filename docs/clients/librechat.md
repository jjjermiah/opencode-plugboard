# LibreChat

Verified: docs only. The `endpoints.custom` fields, the `provider: 'anthropic'` endpoint, `${VAR}` expansion from `.env`, the compose override mount and the rules that drop an endpoint were checked against librechat.ai. The config `version` is `1.3.17`, the value LibreChat's current docs use (the issue said `1.3.13`). Not run: LibreChat is a Docker stack, and the dev server at `127.0.0.1:4010` was down. No scripted check against LibreChat's own API was written.

LibreChat is a ChatGPT-style chat UI. Its custom endpoints take any OpenAI-compatible base URL. It also has a native Anthropic endpoint (`provider: anthropic`), which calls the Messages API. This page sets up both against plugboard.

## Plugboard options

The LibreChat container reaches plugboard through the host's gateway address, so plugboard binds a non-loopback address and needs keys. See [reaching plugboard from another host or container](any-app.md#reaching-plugboard-from-another-host-or-container).

```jsonc
"options": {
  "listen": { "host": "0.0.0.0", "port": 4010 },
  "keys": { "librechat": "{env:PLUGBOARD_KEY_LIBRECHAT}" },
  "models": ["anthropic/claude-haiku-4-5", "anthropic/claude-sonnet-4-6"],
  "aliases": { "fast": "anthropic/claude-haiku-4-5" }
}
```

Bind a specific interface address instead of `0.0.0.0` when you can, and keep the port closed to everything but the Docker host. The key crosses the network in plain HTTP. A `listen` change needs an OpenCode restart.

## LibreChat config

In `librechat.yaml`, under `endpoints.custom`:

```yaml
version: 1.3.17
cache: true
endpoints:
  custom:
    - name: 'Plugboard'
      apiKey: '${PLUGBOARD_KEY}'
      baseURL: 'http://host.docker.internal:4010/v1'
      models:
        default: ['fast']
        fetch: true
      titleConvo: true
      titleModel: 'fast'
      modelDisplayLabel: 'Plugboard'
    - name: 'Plugboard (Claude)'
      provider: 'anthropic'
      apiKey: '${PLUGBOARD_KEY}'
      baseURL: 'http://host.docker.internal:4010'
      headers:
        anthropic-version: '2023-06-01'
      models:
        default: ['fast']
        fetch: false
```

- **Plugboard** uses the OpenAI shape. LibreChat appends `/chat/completions` to `baseURL`, so the base URL ends in `/v1`. `fetch: true` reads `/v1/models`, and `default` is the fallback list.
- **Plugboard (Claude)** uses `provider: 'anthropic'`, which calls the native `/v1/messages` on `baseURL`. Its base URL is the root, with no `/v1`, as for the other Anthropic clients ([Anthropic Messages](../messages.md)). plugboard ignores `anthropic-version`.

Docker: put the key in `.env` (see [examples/librechat/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/librechat)), so `${PLUGBOARD_KEY}` expands. Mount the file with `docker-compose.override.yml`:

```yaml
services:
  api:
    volumes:
      - type: bind
        source: ./librechat.yaml
        target: /app/librechat.yaml
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

The `extra_hosts` line is for Linux. Docker Desktop provides `host.docker.internal` already. Then restart with `docker compose down && docker compose up -d`.

## Features exercised

- **OpenAI endpoint**: streaming, tool calls, images, and model listing from `/v1/models`. With `titleConvo: true`, LibreChat also sends a second request per new conversation to `titleModel`.
- **Anthropic endpoint**: `POST /v1/messages` with streaming and tools.

## Quirks

- LibreChat keeps a custom endpoint only if `name`, `baseURL`, `apiKey` and `models` are all present, and `models` has `fetch: true` or a non-empty `default`. An entry that fails the check is dropped from the list with no error and no log line. Check those fields first when an endpoint is missing.
- An unresolved `${VAR}` in `apiKey` fails with "Missing API Key", and in `baseURL` with "Missing Base URL". An unresolved value under `headers` is sent upstream as the literal text, so the failure comes from the provider.
- `titleConvo: true` costs a request per conversation. Keep `titleModel` a cheap alias such as `fast`.
- A gateway that only exposes Claude models over the OpenAI shape should use the first block, without `provider`. Use `provider: 'anthropic'` only for the native Messages API, as plugboard serves it.
- `directEndpoint` is needed only when `baseURL` already holds the full completions path. Plugboard's base URLs here do not.
