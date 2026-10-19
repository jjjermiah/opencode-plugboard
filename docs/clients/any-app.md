# Any OpenAI-compatible app

An app that lets you set a base URL, an API key and a model name can use plugboard.

| Setting | Value |
| --- | --- |
| Base URL | `http://127.0.0.1:4010/v1` (change the port if you changed `listen.port`) |
| API key | a key from the plugboard `keys` option, not a provider key |
| Model | an alias from `aliases`, or `provider/model[#variant]` |

Check it before you configure the app:

```sh
curl http://127.0.0.1:4010/v1/models -H "Authorization: Bearer $PLUGBOARD_KEY"
curl http://127.0.0.1:4010/v1/chat/completions \
  -H "Authorization: Bearer $PLUGBOARD_KEY" -H "Content-Type: application/json" \
  -d '{"model": "fast", "messages": [{"role": "user", "content": "reply with exactly: pong"}]}'
```

`/v1/models` lists the models the key may use; anything else answers 404 `model_not_found`.

## Tool calls

Plugboard returns tool calls to the app and never runs them. The app runs them and sends the results back as `tool` messages, the normal Chat Completions loop.

## Structured output

`response_format` with `json_schema` works. The provider does not enforce the schema, so validate the result. `json_object` carries no schema, so name the keys in your prompt. With `tools` and `json_schema` together, the model either calls one of your tools or gives the schema answer.

## Limits

- Model names can contain `/` and `#`, which some apps mishandle. Give such models an alias.
- Images work as `data:` URLs. `http(s)` image URLs work only when the `remoteImages` option allows them.
- Embeddings and audio are not served.
- After an OpenCode restart, the port opens when a client first touches the server. See [Warm-up](../warm-up.md).

## The app runs on another machine or in a container

`127.0.0.1` reaches plugboard only from the OpenCode host. From a container, `localhost` is the container itself. See [Serving other machines](../guides/serving-other-machines.md) for binding an address, keys, firewalls, tunnels and reverse proxies. In short:

- Bind a reachable address with `listen.host` (keys are then required), and allow only the client's address in the host firewall. The connection is plain HTTP.
- From Docker use `http://host.docker.internal:4010/v1` (on Linux add `--add-host host.docker.internal:host-gateway`).
- Or keep the loopback bind and use an SSH tunnel (`ssh -N -L 4010:127.0.0.1:4010 <server>`) or a reverse proxy that sends `Host: 127.0.0.1:4010`.

```sh
curl http://<host-address>:4010/healthz
```

A 403 `invalid_host` means a loopback bind saw another `Host` header; a 401 means the key is wrong; connection refused means the bind, the firewall or the warm-up.
