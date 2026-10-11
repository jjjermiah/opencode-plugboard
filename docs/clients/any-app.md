# Any OpenAI-compatible app

An app that lets you set a base URL, an API key and a model id can use plugboard. Three settings:

| Setting | Value |
| --- | --- |
| Base URL | `http://localhost:4010/v1` (change the port if you changed `listen.port`) |
| API key | a key from the plugboard `keys` option, not a provider key |
| Model | `provider/model[#variant]` or an alias from `aliases` |

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

`response_format` with `json_schema` is supported. Plugboard instructs the model to answer through a `respond` tool and returns its arguments as the message content. The provider does not enforce the schema, so validate the result. `json_object` is supported too but carries no schema, so weak models may ignore your keys.

## Gotchas

- The model must be on the `models` allowlist. With no `models`, chat calls return 403 `no_models_configured`.
- Ids can contain `/` and `#`, which some UIs mishandle in URLs or dropdowns. Define an alias in `aliases` for those.
- Only Chat Completions and the model list exist. Apps that call `/v1/responses`, embeddings, audio or images fail. Many SDKs default to `/v1/responses` for newer models: look for a "use chat completions" switch.
- After an OpenCode restart the port stays closed until a client touches the server. See [Warm-up](../../README.md#warm-up-for-always-on-servers).
- From a container, `localhost` is the container. See [compat/docker/README.md](../../compat/docker/README.md).
