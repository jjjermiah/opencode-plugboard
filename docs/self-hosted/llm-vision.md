# LLM Vision for Home Assistant

LLM Vision is a Home Assistant integration, installed through HACS. It sends camera snapshots, images and video frames to a multimodal model and writes the answer to a sensor or to the timeline. Frigate events can go through it too.

| | |
| --- | --- |
| Upstream | [valentinfrlch/ha-llmvision](https://github.com/valentinfrlch/ha-llmvision) (about 1.5k stars), commit [b81d626](https://github.com/valentinfrlch/ha-llmvision/tree/b81d62688f549332194413ae500eed81b313a58e) |
| Config source | `config_flow.py` (`async_step_custom_openai`), `providers.py` (`OpenAI`, `_get_request_url`, `_prepare_vision_data`), `services.yaml` (`image_analyzer`) and `media_handlers.py` at that commit |
| Plugboard API | `/v1/chat/completions` with images as `data:image/jpeg;base64,...` URLs |
| Status | **Vision chat works through the Custom OpenAI provider, per the source.** Not run. Use this provider, not LocalAI (see below). docs-verified, not run (checked 2026-10-13) |

The text-only conversation path is a different integration: see [#237](https://github.com/jjjermiah/opencode-plugboard/issues/237). Core Home Assistant's OpenAI integration cannot point at a compatible endpoint, so it is not a candidate.

## Plugboard options

Add the key and a vision alias to the plugin entry. Use a model that accepts images:

```jsonc
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "llm-vision": "{env:PLUGBOARD_KEY_LLM_VISION}" },
    "models": ["anthropic/claude-sonnet-4-6"],
    "aliases": {
      "vision": "anthropic/claude-sonnet-4-6"
    },
    "apps": { "llm-vision": { "models": ["vision"] } }
  }
}
```

## Home Assistant setup

Add the integration, then choose the **Custom OpenAI** provider from its menu (`config_flow.py`, the menu entry at line 84; `strings.json` titles the step "Configure Custom OpenAI provider"). The step has two sections, from `async_step_custom_openai`:

| Section | Field | Value |
| --- | --- | --- |
| Connection | API key | The plugboard app key. Required. Sent as `Authorization: Bearer` |
| Connection | Endpoint | `http://192.0.2.10:4010/v1/chat/completions`. The form's placeholder is this full path |
| Model | Default model | `vision`, the plugboard alias |
| Model | Temperature, top P | Defaults 0.5 and 0.9 |

The endpoint is used as entered, unless it ends in `/v1`. Then `/chat/completions` is added (`_get_request_url`). The full path above is the one the form shows, so use it.

When you save, the step sends a short `Hi` request to the endpoint with the model. If that fails, the form shows `handshake_failed`.

## Calling it

The service is `llmvision.image_analyzer`, from `services.yaml`. Its fields that matter here:

- `provider`: the config entry you created.
- `model`: optional. It overrides the default model. Set it to `vision` to use the alias.
- `message`: the prompt. Required.
- `image_entity` (an image or camera entity) or `image_file` (a local path).
- `max_tokens`: default 3000.

## What is sent

The Custom OpenAI provider uses the `OpenAI` class in `providers.py`:

- `max_completion_tokens`, `temperature` and `top_p`. `reasoning_effort` is never sent for the `vision` alias: the provider adds it only when the model name starts with one of the GPT-5 names in its table (`_model_supports_thinking`, `providers.py`), and the alias is not one of them.
- A `system` message, then the user message with one `text` part and one `image_url` part per image.
- An image as `{"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,..."}}`. The base64 data is the snapshot. The code adds this form in `_prepare_vision_data` (around line 748). Memory images use the same form (`memory.py`).
- When the call asks for JSON and gives a schema: `response_format` with `type: json_schema`, `strict: true`, and `additionalProperties: false` added to the schema.

Sampling: `temperature` 0.5 and `top_p` 0.9 are sent by default (the Custom OpenAI step's model defaults, `config_flow.py`). If the alias targets Claude 4.6 or older, plugboard drops `top_p` and reports it in `x-plugboard-dropped-params` (`src/openai/sampling.ts`, lines 56 to 58). With `dropUnsupportedParams: false`, Anthropic rejects the call with a 400 that says the two cannot both be specified. Leave the option on.

No `http(s)` image URL is sent. The images are base64 data in every request path in `providers.py` and `memory.py`. So plugboard's `remoteImages` option can stay off.

Plugboard accepts `max_completion_tokens` and `response_format` `json_schema`. It checks each `data:` image: it must be `image/*`, valid base64, and start with a PNG, JPEG, GIF or WebP signature. `MediaProcessor._encode_image` (`media_handlers.py`, lines 40 to 45) saves each image as JPEG before base64 encoding, so snapshots pass that check. Images that bypass this encoder were not checked.

## What works and what does not

- **Snapshot analysis with a vision alias**: works per the source. Not run.
- **Structured answers (`json_schema`)**: sent when the call asks for them. Not run through plugboard.
- **Text-only calls**: the same provider, without images. Works per the source.
- **Video and camera feeds**: the media code converts frames to JPEG (`media_handlers.py`, around lines 746 to 806), so frames go through the same path. Not checked.
- **Frigate events**: not checked.
- **Remote image URLs**: not sent. Nothing for plugboard to fetch.
- **Embeddings, speech and image generation**: not used by this integration.

## Gotchas

- **Do not use LocalAI with plugboard keys.** The LocalAI provider sends `headers = {}` (`providers.py`, around line 1601). It sends no `Authorization` header. Once plugboard has `keys` set, it refuses the request. Use Custom OpenAI, which sends the key.
- **The validation request uses the model you enter.** Enter the alias `vision`. A model that plugboard does not know makes the handshake fail.
- **Memory needs setup.** Memory is an option for `image_analyzer`. It is not covered here.

## Sources

- [LLM Vision `config_flow.py` at b81d626](https://github.com/valentinfrlch/ha-llmvision/blob/b81d62688f549332194413ae500eed81b313a58e/custom_components/llmvision/config_flow.py) (read 2026-10-13)
- [LLM Vision `providers.py` at b81d626](https://github.com/valentinfrlch/ha-llmvision/blob/b81d62688f549332194413ae500eed81b313a58e/custom_components/llmvision/providers.py) (read 2026-10-13)
- [LLM Vision `services.yaml` at b81d626](https://github.com/valentinfrlch/ha-llmvision/blob/b81d62688f549332194413ae500eed81b313a58e/custom_components/llmvision/services.yaml) (read 2026-10-13)
- [LLM Vision `media_handlers.py` at b81d626](https://github.com/valentinfrlch/ha-llmvision/blob/b81d62688f549332194413ae500eed81b313a58e/custom_components/llmvision/media_handlers.py) (read 2026-10-13)
- [LLM Vision provider docs](https://llm-vision.gitbook.io/getting-started/setup/providers) (read 2026-10-13). They list Ollama, Open WebUI and LocalAI as self-hosted providers and no Custom OpenAI entry, so the Custom OpenAI setup on this page comes from the source.
