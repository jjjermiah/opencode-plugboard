# LLM Vision for Home Assistant

LLM Vision is a Home Assistant integration, installed through HACS. It sends camera snapshots, images and video frames to a multimodal model and writes the answer to a sensor or the timeline. Frigate events can go through it.

For text conversation, use [Extended OpenAI Conversation](../clients/home-assistant-extended-openai.md). Core Home Assistant's OpenAI integration cannot point at a compatible endpoint.

## Plugboard options

Give LLM Vision its own key and a vision alias. Home Assistant reaches plugboard over the network ([Serving other machines](../guides/serving-other-machines.md)).

```jsonc plugboard-options
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "llm-vision": "{env:PLUGBOARD_KEY_LLM_VISION}" },
    "models": ["anthropic/claude-sonnet-4-6"],
    "aliases": { "vision": "anthropic/claude-sonnet-4-6" },
    "apps": { "llm-vision": { "models": ["vision"] } }
  }
}
```

Keep `dropUnsupportedParams` on. LLM Vision sends `temperature` 0.5 and `top_p` 0.9. A Claude 4.6 or older model takes only one of them, so plugboard drops `top_p` and lists it in `x-plugboard-dropped-params`.

## Connect

Add the integration and choose the **Custom OpenAI** provider:

| Section | Field | Value |
| --- | --- | --- |
| Connection | API key | the `llm-vision` key |
| Connection | Endpoint | `http://192.0.2.10:4010/v1/chat/completions` (your plugboard host, full path) |
| Model | Default model | `vision` |

Saving sends a short test request with that model. If it fails, the form shows `handshake_failed`. Check the alias name and that Home Assistant can reach plugboard.

Call it with `llmvision.image_analyzer`. Set `provider` to the entry you created, `message` to the prompt, and `image_entity` or `image_file`. Set `model: vision` to override the default model.

## What works

- Snapshot analysis through the `vision` alias. LLM Vision sends images as base64 `data:` URLs, so `remoteImages` can stay off.
- Structured answers. A call that asks for JSON sends `json_schema`.
- Text-only calls through the same provider.

## Limits

- Do not use the **LocalAI** provider. It sends no `Authorization` header, so plugboard refuses it once `keys` is set. Use Custom OpenAI.
- Embeddings, speech and image generation are not used by this integration.
