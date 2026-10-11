# Any OpenAI-compatible app

An app that lets you set a base URL, an API key and a model id can use plugboard. Three settings:

| Setting | Value |
| --- | --- |
| Base URL | `http://localhost:4010/v1` (change the port if you changed `listen.port`) |
| API key | a key from the plugboard `keys` option, not a provider key |
| Model | `provider/model[#variant]` or an alias from `aliases` |

Install the plugin pinned to a version in your global OpenCode config, for example `"package": "opencode-plugboard@0.7.0"`. A bare `"opencode-plugboard"` means `latest`, so a cache refresh or `opencode plugin update` can pull a release you have not read. A global plugin runs inside OpenCode in every project, next to your provider logins, so move the pin on purpose after reading the [changelog](https://github.com/jjjermiah/opencode-plugboard/blob/main/CHANGELOG.md). The full config is in the [README](https://github.com/jjjermiah/opencode-plugboard#quick-start).

```sh
curl http://localhost:4010/v1/models -H "Authorization: Bearer $PLUGBOARD_KEY"
curl http://localhost:4010/v1/chat/completions \
  -H "Authorization: Bearer $PLUGBOARD_KEY" -H "Content-Type: application/json" \
  -d '{"model": "fast", "messages": [{"role": "user", "content": "reply with exactly: pong"}]}'
```

`/v1/models` lists the model ids the app may use. Anything else returns 404 `model_not_found`.

## Tool calls

Plugboard returns the tool calls to the app and never runs them. The app executes them and sends the results back as `tool` messages, which is the normal Chat Completions loop. SparkyFitness, a real app that calls tools, was verified this way.

## Structured output

`response_format` with `json_schema` is supported. Plugboard instructs the model to answer through a `respond` tool and returns its arguments as the message content. The provider does not enforce the schema, so validate the result. `json_object` adds a system instruction and carries no schema, so name the keys in your prompt: weak models may ignore them. When a model wraps the JSON in a markdown code fence, plugboard strips that one fence if the inside parses as JSON (a fenced stream arrives as one content chunk). Sending `tools` together with `json_schema` is changing to return the caller's tool calls ([#34](https://github.com/jjjermiah/opencode-plugboard/issues/34)); don't rely on the current behaviour for that combination.

## Gotchas

- The model must be on the `models` allowlist. With no `models`, chat calls return 403 `no_models_configured`.
- Ids can contain `/` and `#`, which some UIs mishandle in URLs or dropdowns. Define an alias in `aliases` for those.
- Chat Completions, the Responses API (stateless, see [responses.md](../responses.md)) and the model list exist. Embeddings, audio and images fail.
- After an OpenCode restart the port stays closed until a client touches the server. See [Warm-up](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/warm-up.md).
- From another host or a container, `localhost` is not plugboard. See the next section.

## Reaching plugboard from another host or container

Plugboard binds `127.0.0.1` by default, which only the same machine can reach. To serve another host or a container:

1. Bind a reachable address and set keys. A non-loopback `listen.host` refuses to start without `keys`.

   ```jsonc
   "options": {
     "listen": { "host": "0.0.0.0", "port": 4010 },
     "keys": { "my-app": "{env:PLUGBOARD_KEY_MY_APP}" },
     "models": ["anthropic/claude-sonnet-4-6"]
   }
   ```

   `listen` changes need a server restart. Use a specific interface address instead of `0.0.0.0` when you can.
2. Limit who can connect. The endpoint speaks plain HTTP, so the key crosses the network in clear text. Allow only the client's address in the host firewall, or keep the loopback bind and tunnel (step 4).
3. Point the client at `http://<host-address>:4010/v1` with that key. From a container use the host's name for itself: `host.docker.internal` (Docker Desktop, Colima; on Linux add `--add-host host.docker.internal:host-gateway`) or `host.lima.internal` (Lima). A container reaches the host through its gateway address, not through loopback, so this needs the non-loopback bind and keys from step 1. Even where a container can reach a loopback-bound listener, its `Host: host.docker.internal:4010` fails the loopback check with 403 `invalid_host`.
4. Alternatives that keep the loopback bind:
   - SSH tunnel: `ssh -N -L 4010:127.0.0.1:4010 <server>`, then use `http://127.0.0.1:4010/v1`. Keep the local port equal to `listen.port`, because the `Host` check compares the port too (a client on local port 4011 gets 403).
   - Reverse proxy on the same machine: it must send `Host: 127.0.0.1:4010` upstream. nginx: `proxy_set_header Host 127.0.0.1:4010;`. Caddy: `header_up Host 127.0.0.1:4010`. Turn response buffering off so streaming works (nginx: `proxy_buffering off;`). Terminate TLS at the proxy.
   - A reverse proxy in front of a non-loopback bind needs no `Host` rewrite, because the check only applies to loopback binds. Keep `keys` set.

Check from the client side before configuring the app:

```sh
curl http://<host-address>:4010/healthz                                          # no key needed
curl http://<host-address>:4010/v1/models -H "Authorization: Bearer $PLUGBOARD_KEY"
```

A 403 `invalid_host` means a loopback bind is seeing a foreign `Host`. A 401 means the key is missing or wrong. Connection refused means the bind, the firewall, or the missing warm-up (see [Warm-up](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/warm-up.md)).
