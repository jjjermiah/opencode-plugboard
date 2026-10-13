# Dify

Dify is an open-source LLM app platform. Its **OpenAI-API-compatible** model provider takes any OpenAI-compatible base URL, so plugboard is added as a custom model on that provider. Plugboard serves `/v1/chat/completions`, which is what the provider's **Chat** completion mode calls.

Verified: docs only, 2026-10-13. The Add Model flow was checked against Dify's [model provider guide](https://docs.dify.ai/en/use-dify/workspace/model-providers) (read 2026-10-13). Field names, defaults and request paths were checked against the plugin source at [dify-official-plugins `24d1b81`](https://github.com/langgenius/dify-official-plugins/tree/24d1b811877408af1b5dfc2bf1cd2a3ec17d91df/models/openai_api_compatible) (plugin version 0.0.68). Not run: no Dify instance was pointed at the dev server, so no chat, stream, agent or structured-output call was made through this provider.

## Plugboard options

Give Dify its own app key and limit it to the models it uses:

```jsonc
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "dify": "{env:PLUGBOARD_KEY_DIFY}" },
    "models": ["anthropic/claude-sonnet-4-6"],
    "aliases": { "fast": "anthropic/claude-sonnet-4-6" },
    "apps": { "dify": { "models": ["fast"] } }
  }
}
```

A non-loopback `listen.host` needs `keys` set. If Dify runs in Docker, plugboard is reached as `host.docker.internal` (see [reaching plugboard from another host or container](any-app.md#reaching-plugboard-from-another-host-or-container)).

## Add Model

In **Integrations** > **Model Provider**, install **OpenAI-API-compatible**, click **Setup** and enter the API key, then click **Add Model** on its card. Model type is **LLM**. These are the fields the plugin asks for (`provider/openai_api_compatible.yaml`):

| Field | Value | Notes |
| --- | --- | --- |
| Model Name | the name Dify shows, for example `fast` | Dify's own key for the model. Sent as the API model only if **model name for API endpoint** is empty |
| model name for API endpoint | `fast` | The id plugboard receives as `model`. Must be in the app's `models` (or a 404 `model_not_found`) |
| API Key | the `dify` app key | Sent as `Authorization: Bearer`. Not the provider's key |
| API Base URL | `http://host.docker.internal:4010/v1` | Include `/v1`. The plugin appends `chat/completions` (`llm.py`, lines 223 to 240). Without `/v1` the request goes to a path plugboard does not serve |
| Completion mode | Chat | The default. Completion mode posts to `/completions`; not tested here |
| Model context size | the model's real window | The plugin's default is `4096` |
| Upper bound for max tokens | the model's real limit | Default `4096`. Dify's cap on `max_tokens` |
| Function Call Type | Tool Call | Default is **Not Support**. With the default, Dify sends no `tools`, so agent and tool nodes do not call tools |
| Vision Support | Support | Only for an alias that accepts images. Default is **Not Support** |
| Include Usage in Stream | Enabled | The default. Sends `stream_options.include_usage`, which plugboard supports |
| API Type | Chat Completions API | The default. The Responses API option is not needed here |

Leave the other fields at their defaults unless a call fails. **Video Support**, **Audio Support** and **Document Support** default to off. Keep them off: plugboard rejects video and audio sent as `image_url` (400 `invalid_image`) and accepts a `file` part only as a PDF data URL (400 `invalid_file` otherwise).

The provider also offers embedding, rerank and speech types. Plugboard has no embeddings or audio, so add only LLM models.

## Tool calls

With **Function Call Type** set to **Tool Call**, Dify sends the tools of the node or agent. Plugboard returns the model's `tool_calls` and never runs them; Dify runs them and sends the results back as `tool` messages, the normal Chat Completions loop. A streamed tool call arrives as one delta carrying the whole arguments string ([configuration](../configuration.md)). A Dify agent round trip was not run.

Plugboard's `maxTools` default is 64. A Dify workflow that passes many tools gets 400 `too_many_tools`; raise `maxTools` globally, or lower the number of tools per node.

## Structured output

The plugin turns a `json_schema` response format into a system-prompt instruction and does not send the schema as a field (`llm.py`, lines 559 to 583). Whether Dify also sends a `response_format` field is decided by Dify core, which is not in this plugin, and was not checked. When plugboard receives `json_schema`, it answers through a `respond` tool and returns the arguments as the content. Either way the provider does not enforce the schema, so validate the JSON in the workflow. Not run.

## Images

Dify sends each image as an `image_url` part with the value of the image content's `data` (`llm.py`, lines 478 to 500). Plugboard takes a `data:image/...` URL directly. An `http(s)` URL is fetched only when the `remoteImages` option is on, and then only public addresses. Which form Dify sends is set by Dify core and was not checked here. Turn `remoteImages` on only after you see an `http(s)` URL in a request.

## Gotchas

- **Save runs a live check.** On save, the plugin posts `ping` with `max_tokens: 5` and a `thinking` field to `/chat/completions` and fails the save on any non-200 (`llm.py`, lines 229 to 261). Plugboard must be reachable from the Dify server at that moment. Whether plugboard accepts the `thinking` field was not checked.
- **Dify Cloud cannot reach a LAN plugboard.** Use a self-hosted Dify on a host that can reach plugboard.
- **Models are typed by hand.** Dify does not list plugboard's models. Each model is its own entry, and an id not in the app's `models` is refused.

## Sources

- [Dify, model providers](https://docs.dify.ai/en/use-dify/workspace/model-providers) (read 2026-10-13)
- [OpenAI-API-compatible plugin, `provider/openai_api_compatible.yaml`](https://github.com/langgenius/dify-official-plugins/blob/24d1b811877408af1b5dfc2bf1cd2a3ec17d91df/models/openai_api_compatible/provider/openai_api_compatible.yaml) (commit 24d1b81, read 2026-10-13)
- [OpenAI-API-compatible plugin, `models/llm/llm.py`](https://github.com/langgenius/dify-official-plugins/blob/24d1b811877408af1b5dfc2bf1cd2a3ec17d91df/models/openai_api_compatible/models/llm/llm.py) (commit 24d1b81, read 2026-10-13)
- Plugboard: [configuration.md](../configuration.md) (`maxTools`, `remoteImages`, `dropUnsupportedParams`), [any-app.md](any-app.md)

Status: docs-verified, not run (checked 2026-10-13). Dify, the plugin and the plugboard alias were not run together.
