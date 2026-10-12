# paperless-gpt

paperless-gpt is a companion to paperless-ngx. It suggests titles, tags, correspondents and document types with an LLM, and it can run OCR through a vision model.

| | |
| --- | --- |
| Upstream | [icereed/paperless-gpt](https://github.com/icereed/paperless-gpt) (about 2.8k stars) |
| Config source | the README, and `docs/openai_compatible_providers.md` in the same repo |
| Plugboard API | `/v1/chat/completions`, with images for LLM OCR |
| Status | Works for suggestions and OCR. No embeddings used. docs-verified, not run (checked 2026-10-11) |

## Plugboard options

```jsonc
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "paperless-gpt": "{env:PLUGBOARD_KEY_PAPERLESS_GPT}" },
    "models": ["opencode-go/glm-5.3-flash", "anthropic/claude-sonnet-4-6"],
    "aliases": {
      "text": "opencode-go/glm-5.3-flash",
      "vision": "anthropic/claude-sonnet-4-6"
    },
    "apps": { "paperless-gpt": { "models": ["text", "vision"] } }
  }
}
```

`text` handles suggestions. `vision` handles OCR, and it must accept images.

## paperless-gpt config

The README's compose example sets the provider with env vars. Use the plugboard key and aliases:

```sh
LLM_PROVIDER=openai
LLM_MODEL=text
OPENAI_API_KEY=<the paperless-gpt app key>
OPENAI_BASE_URL=http://host.docker.internal:4010/v1
VISION_LLM_PROVIDER=openai
VISION_LLM_MODEL=vision
```

The README lists `OPENAI_BASE_URL` as the base URL for any OpenAI-compatible endpoint. The upstream `openai_compatible_providers.md` page says it must point at the API root, which for plugboard ends in `/v1`. `OPENAI_API_KEY` is the plugboard app key, not an OpenAI key.

A runnable copy is in [`examples/self-hosted/paperless-gpt/`](https://github.com/jjjermiah/opencode-plugboard/blob/main/examples/self-hosted/paperless-gpt/README.md).

## What works and what does not

- **Suggestions** (title, tags, correspondent, document type): through `LLM_MODEL`.
- **LLM OCR**: `VISION_LLM_PROVIDER` and `VISION_LLM_MODEL`. Needed only if you set the OCR provider to `llm`.
- **Embeddings**: the README does not describe any embedding use. Nothing to route to plugboard.
- **Structured output**: not checked against plugboard.

## Gotchas

- paperless-gpt has no authentication. Its README says the UI and `/api/*` are open to anyone who can reach the port, and that it listens on all interfaces by default. Publish the port on the host loopback or a trusted network only.
- Keep the paperless-ngx API token in an env file, not in the compose file.

## Sources

- [paperless-gpt README](https://github.com/icereed/paperless-gpt/blob/main/README.md)
- [OpenAI-compatible providers](https://github.com/icereed/paperless-gpt/blob/main/docs/openai_compatible_providers.md)
