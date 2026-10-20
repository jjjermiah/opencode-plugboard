# paperless-gpt

paperless-gpt is a companion to paperless-ngx. An LLM suggests titles, tags, correspondents and document types, and a vision model can run OCR.

Upstream: [source](https://github.com/icereed/paperless-gpt).

## Plugboard options

Give paperless-gpt its own key. `vision` handles OCR and must accept images. Docker needs a reachable address ([Serving other machines](../guides/serving-other-machines.md)).

```jsonc plugboard-options
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "paperless-gpt": "{env:PLUGBOARD_KEY_PAPERLESS_GPT}" },
    "models": ["opencode-go/glm-5.3-flash", "anthropic/claude-sonnet-4-6"],
    "aliases": {
      "text": "opencode-go/glm-5.3-flash",
      "vision": "anthropic/claude-sonnet-4-6"
    },
    "apps": { "paperless-gpt": { "allowedModels": ["text", "vision"] } }
  }
}
```

## Connect

<<< @/../examples/self-hosted/paperless-gpt/.env.example#snippet{ini}

`OPENAI_API_KEY` takes the plugboard key. `OPENAI_BASE_URL` ends in `/v1`.

The `.env` and a compose file are in [`examples/self-hosted/paperless-gpt/`](https://github.com/jjjermiah/opencode-plugboard/blob/main/examples/self-hosted/paperless-gpt/README.md).

## What works

- Suggestions for title, tags, correspondent and document type, through `LLM_MODEL`.
- LLM OCR, through `VISION_LLM_PROVIDER` and `VISION_LLM_MODEL`. Set the OCR provider to `llm` to use it.

## Limits

- paperless-gpt has no login. Anyone who can reach its port can use the UI and `/api/*`. Publish the port on loopback or a trusted network.
- Keep the paperless-ngx API token in an env file, not in the compose file.
