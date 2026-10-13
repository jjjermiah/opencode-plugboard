# Dify

Dify is an open-source LLM app platform. Its **OpenAI-API-compatible** model provider takes any OpenAI-compatible base URL, so plugboard is added as a custom model on that provider. Plugboard serves `/v1/chat/completions`, which is what the provider's **Chat** completion mode calls.

Verified: docs only, 2026-10-13. The Add Model flow was checked against Dify's [model provider guide](https://docs.dify.ai/en/use-dify/workspace/model-providers) (read 2026-10-13). Field names and defaults were checked against the plugin source at [dify-official-plugins `24d1b81`](https://github.com/langgenius/dify-official-plugins/tree/24d1b811877408af1b5dfc2bf1cd2a3ec17d91df/models/openai_api_compatible) (plugin version 0.0.68). The request shapes were checked against the Dify plugin SDK at [dify-plugin-sdks `86e81e7`](https://github.com/langgenius/dify-plugin-sdks/blob/86e81e7/src/dify_plugin/interfaces/model/openai_compatible/llm.py) (`main`, read 2026-10-13); that is not necessarily the exact SDK version the plugin locks. Not run: no Dify instance was pointed at the dev server, so no chat, stream, agent or structured-output call was made through this provider.

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
| Model Name | the name Dify shows, for example `fast` | Dify's key for the model. The API model is the endpoint name below, or this name when that field is left blank |
| model name for API endpoint | `fast` | The id plugboard receives as `model`. Must be in the app's `models`, or plugboard answers 404 `model_not_found` |
| API Key | the `dify` app key | Sent as `Authorization: Bearer`. Not the provider's key |
| API Base URL | `http://host.docker.internal:4010/v1` | Include `/v1`. The SDK appends `chat/completions` (SDK `llm.py`, lines 562 to 568; the save-time check uses line 247). Without `/v1` the request goes to a path plugboard does not serve |
| Completion mode | Chat | The default. Completion mode posts to `/completions`; not tested here |
| Model context size | the model's real window | The plugin's default is `4096` |
| Upper bound for max tokens | the model's real limit | Default `4096`. Dify's cap on `max_tokens` |
| Function Call Type | Tool Call | Default is **Not Support**. With Tool Call, Dify sends `tools` and `tool_choice: "auto"`. With the default it sends no tools, so agent and tool nodes do not call tools |
| Stream function calling | Not Support (default) | Leave the default unless you test streamed tool calls. Plugboard sends a streamed tool call as one delta with the whole arguments string |
| Vision Support | Support | Only for an alias that accepts images. Default is **Not Support** |
| Structured Output | Not Support (default) | Support sends a `response_format` with a `json_schema`. Read [Structured output](#structured-output) before turning it on |
| Compatibility mode | OpenAI compatible (default) | Keep it. **Enable extra settings** adds fields such as `thinking` and `enable_thinking`, which the default never sends |
| Thinking Mode Support | Only Non-Thinking Mode (default) | Controls the thinking toggle in Dify's UI |
| Include Usage in Stream | Enabled | The default. Sends `stream_options.include_usage`, which plugboard supports |
| API Type | Chat Completions API | The default. The Responses API option is not needed here |

Leave the other fields at their defaults unless a call fails. **Video Support**, **Audio Support** and **Document Support** default to off. Keep them off: see [Images](#images).

The provider also offers embedding, rerank and speech types. Plugboard has no embeddings or audio, so add only LLM models.

## Tool calls

With **Function Call Type** set to **Tool Call**, Dify sends the tools of the node or agent, with `tool_choice: "auto"`. Plugboard returns the model's `tool_calls` and never runs them; Dify runs them and sends the results back as `tool` messages, the normal Chat Completions loop. A streamed tool call arrives as one delta carrying the whole arguments string ([configuration](../configuration.md)). That matters only when **Stream function calling** is Support. A Dify agent round trip was not run.

Plugboard's `maxTools` default is 64. A Dify workflow that passes many tools gets 400 `too_many_tools`; raise `maxTools` globally, or lower the number of tools per node.

## Structured output

With **Structured Output** set to Support, the SDK sends `response_format: {"type": "json_schema", "json_schema": <the schema, parsed from the JSON you typed>}` (SDK `llm.py`, lines 524 to 549). It adds no `name` or `strict` wrapper of its own, so the shape depends on what you type. Plugboard requires `json_schema.schema` to be a JSON Schema object (`src/openai/request.ts`, `parseResponseFormat`):

- A schema typed in the wrapper form `{"name": "...", "schema": {...}, "strict": true}` passes, and plugboard answers through its `respond` tool.
- A bare schema (`{"type": "object", "properties": {...}}`) gets 400 `response_format.json_schema.schema must be a JSON Schema object`.

Whether Dify's schema editor adds the wrapper was not checked. Test one workflow before you rely on it. With Structured Output at its default, Dify sends no `response_format`, and the plugin only adds the schema to the system prompt as a hint (`llm.py`, lines 559 to 583). Plugboard does not enforce the schema either way, so validate the JSON in the workflow. Not run.

## Images

Dify core sends images as base64 `data:` URLs by default. Its `MULTIMODAL_SEND_FORMAT` setting defaults to `base64` ([Dify enterprise environment variables](https://enterprise-docs.dify.ai/en/3.0.x/deploy/advanced-configuration/environment-variables)). Plugboard takes a `data:image/...` URL directly, so `remoteImages` is not needed. Only if the deployment sets `MULTIMODAL_SEND_FORMAT=url` does Dify send an `http(s)` URL built from `FILES_URL`. Plugboard fetches that URL only when `remoteImages` is on, and then only public addresses.

Keep **Video Support**, **Audio Support** and **Document Support** off. The plugin sends video and audio as `image_url` parts with a non-image data URL, which plugboard refuses (400 `invalid_image`). A `file` part is accepted only as a PDF data URL (400 `invalid_file` otherwise).

## Gotchas

- **Save runs a live check.** On save, the plugin's base check sends `{model, max_tokens: 5, messages: [ping]}` to `/chat/completions` (SDK `llm.py`, lines 236 to 241) and fails the save on any non-200. When **Token parameter name** is Auto and the endpoint model matches `o1`, `o3`, `gpt-5` or `gpt-6` at the start, after an optional dotted prefix (plugin `llm.py`, lines 48 to 50 and 124 to 130), the check sends `max_completion_tokens: 16` instead. The `thinking` field is added only on a retry, when the first check fails with an error that mentions `thinking` or `budget_tokens` (plugin `llm.py`, lines 145 to 149). Plugboard must be reachable from the Dify server when you save.
- **Unknown body fields are ignored.** Plugboard reads the body fields it knows and does not reject the others, so `thinking`, `enable_thinking`, `service_tier` and `chat_template_kwargs` are ignored (`src/openai/request.ts`). Not run against Dify's requests.
- **Dify Cloud cannot reach a LAN plugboard.** Use a self-hosted Dify on a host that can reach plugboard.
- **Models are typed by hand.** Dify does not list plugboard's models. Each model is its own entry, and an id not in the app's `models` is refused.

## Sources

- [Dify, model providers](https://docs.dify.ai/en/use-dify/workspace/model-providers) (read 2026-10-13)
- [Dify enterprise, environment variables](https://enterprise-docs.dify.ai/en/3.0.x/deploy/advanced-configuration/environment-variables) (`MULTIMODAL_SEND_FORMAT`, read 2026-10-13)
- [OpenAI-API-compatible plugin, `provider/openai_api_compatible.yaml`](https://github.com/langgenius/dify-official-plugins/blob/24d1b811877408af1b5dfc2bf1cd2a3ec17d91df/models/openai_api_compatible/provider/openai_api_compatible.yaml) (commit 24d1b81, read 2026-10-13)
- [OpenAI-API-compatible plugin, `models/llm/llm.py`](https://github.com/langgenius/dify-official-plugins/blob/24d1b811877408af1b5dfc2bf1cd2a3ec17d91df/models/openai_api_compatible/models/llm/llm.py) (commit 24d1b81, read 2026-10-13)
- [Dify plugin SDK, `openai_compatible/llm.py`](https://github.com/langgenius/dify-plugin-sdks/blob/86e81e7/src/dify_plugin/interfaces/model/openai_compatible/llm.py) (commit 86e81e7, read 2026-10-13)
- Plugboard: [configuration.md](../configuration.md) (`maxTools`, `remoteImages`, `dropUnsupportedParams`), [any-app.md](any-app.md)

Status: docs-verified, not run (checked 2026-10-13). Dify, the plugin and the plugboard alias were not run together.
