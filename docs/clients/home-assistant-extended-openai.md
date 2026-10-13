# Home Assistant: Extended OpenAI Conversation

Extended OpenAI Conversation is a custom component for Home Assistant. It adds a **Base Url** to the OpenAI conversation agent and lets the model call Home Assistant services. Plugboard works as its base URL: setup calls `GET /v1/models`, and each conversation turn calls `POST /v1/chat/completions` with tools.

Verified: docs only, 2026-10-13. The setup fields, the `change_config` service, the default request parameters and the default function list were checked against the component source at [extended_openai_conversation `66aafab`](https://github.com/jekalmin/extended_openai_conversation/tree/66aafab5f15c189c0475b41b1368f94787df94a7/custom_components/extended_openai_conversation) (manifest version 3.0.0), and the install and expose steps against its [README](https://github.com/jekalmin/extended_openai_conversation/tree/66aafab5f15c189c0475b41b1368f94787df94a7). Not run: no Home Assistant instance called plugboard, so no voice or text turn and no service call was made through it.

## Plugboard options

Give Home Assistant its own app key and limit it to the models it uses:

```jsonc
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "homeassistant": "{env:PLUGBOARD_KEY_HOMEASSISTANT}" },
    "models": ["anthropic/claude-sonnet-4-6"],
    "aliases": { "assist": "anthropic/claude-sonnet-4-6" },
    "apps": { "homeassistant": { "models": ["assist"] } }
  }
}
```

Home Assistant is reached at the LAN address of the plugboard host, not `localhost`. See [reaching plugboard from another host or container](any-app.md#reaching-plugboard-from-another-host-or-container).

## Install and setup

1. Install from HACS (add the repository as a custom repository) or copy `custom_components/extended_openai_conversation` into the Home Assistant config directory. Restart Home Assistant.
2. **Settings** > **Devices & Services** > **Add Integration** > **Extended OpenAI Conversation**. Enter:
   - **API Key**: the `homeassistant` app key.
   - **Base Url**: `http://192.0.2.10:4010/v1` (your plugboard host, with `/v1`).
   - **Skip Authentication**: off.
3. Open the integration's options and set **Chat model** to a plugboard id, for example `assist`. The field is free text. Its default, `gpt-5-mini`, is not a plugboard id unless you list it: an id outside the app's `models` gets 404 `model_not_found`.
4. **Settings** > **Voice assistants** > edit the assistant > **Conversation agent**: choose **Extended OpenAI Conversation**.
5. Expose the entities you want the model to control at `http://{your-home-assistant}/config/voice-assistants/expose` (the README's preparation step).

Setup validates the key and URL by calling `client.models.list` (`helpers.py`, lines 169 to 173). It does not check the chat model. A wrong chat model passes setup and fails on the first turn with `model_not_found`.

## What the component sends

- **Model parameters.** Model names that start with `gpt-5` or `o1` to `o4` get `max_completion_tokens` and no `temperature` or `top_p` (`const.py`, `MODEL_CONFIG_PATTERNS`). Any other name, including a plugboard id, gets `max_tokens` (the max tokens option, default 500), `temperature` 0.5 and `top_p` 1 (`DEFAULT_MODEL_CONFIG`). Do not name a plugboard alias with those prefixes unless you want that parameter set.
- **Reasoning aliases.** A reasoning model spends part of `max_tokens` on reasoning. 500 may leave no visible answer. Raise **Maximum tokens** for such an alias. Not measured here.
- **Sampling that providers reject.** Plugboard drops `temperature` and `top_p` for models known to reject them and lists them in `x-plugboard-dropped-params`. Leave `dropUnsupportedParams` on ([configuration](../configuration.md)).
- **Streaming.** `stream: true` with `stream_options.include_usage`. Plugboard supports both. A streamed tool call arrives as one delta carrying the whole arguments string ([configuration](../configuration.md)).

## Tools

The default **Functions** list has one tool, `execute_services` (`const.py`, `DEFAULT_CONF_FUNCTION_TOOLS`). Each entry you add under **Functions** becomes one more tool in every request. Plugboard's `maxTools` default is 64. The 32 that older notes give was the default before 0.25.0 ([Claude Code](claude-code.md)). A default install sends one tool and never reaches the cap. Many custom functions can reach it: a request over the cap gets 400 `too_many_tools`, and the fix is a higher `maxTools` (a global option).

Plugboard returns the model's `tool_calls` and never runs them. Home Assistant runs the service, then sends the result back. **Maximum Function Calls Per Conversation** (default 10) limits the rounds per turn.

## Changing the URL at runtime

`change_config` changes the base URL and key of an existing entry:

```yaml
service: extended_openai_conversation.change_config
data:
  config_entry: <entry id>
  base_url: http://192.0.2.10:4010/v1
  api_key: <the homeassistant app key>
```

The service runs the same `models.list` check before it saves (`services.py`, `get_authenticated_client`). If plugboard is unreachable, the call raises and the entry keeps its old values. A `base_url` equal to `https://api.openai.com/v1` is treated as "no custom URL" and is removed (`services.py`, lines 155 to 159).

## Gotchas

- **Core Home Assistant's OpenAI integration is a different one.** This page covers only the custom component, the one with the Base Url field.
- **Models are on the plugboard allowlist.** An id that is not in the app's `models` gets 404 `model_not_found`.
- **Expose entities first.** The README says the model only knows the devices you expose.
- **Keep the key out of shared configs.** It is entered in the integration form or passed to the service. Do not paste it into `configuration.yaml` or an automation that is shared.

## Sources

- [extended_openai_conversation README](https://github.com/jekalmin/extended_openai_conversation/tree/66aafab5f15c189c0475b41b1368f94787df94a7) (commit 66aafab, read 2026-10-13)
- `custom_components/extended_openai_conversation/` at 66aafab: `config_flow.py`, `services.py`, `services.yaml`, `helpers.py`, `const.py`, `entity.py`, `strings.json`, `manifest.json` (read 2026-10-13)
- Plugboard: [configuration.md](../configuration.md) (`maxTools`, `dropUnsupportedParams`, streamed tool calls), [any-app.md](any-app.md)

Status: docs-verified, not run (checked 2026-10-13). Home Assistant, the component and the plugboard alias were not run together.
