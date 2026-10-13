# Vane (formerly Perplexica)

Vane is a self-hosted answering engine. It searches the web through SearXNG and answers with cited sources, using an LLM for the answer and an embedding model for ranking. It was called Perplexica until its rename.

| | |
| --- | --- |
| Upstream | [ItzCrazyKns/Vane](https://github.com/ItzCrazyKns/Vane) (about 37.3k stars; the old name `ItzCrazyKns/Perplexica` redirects there) |
| Config source | `src/lib/models/providers/openai/index.ts` at [348feca](https://github.com/ItzCrazyKns/Vane/blob/348feca3e378fb4157b217724ed508dc707f853f/src/lib/models/providers/openai/index.ts), `src/app/api/chat/route.ts` at the same commit, and the README's troubleshooting section |
| Plugboard API | `/v1/chat/completions` for the answer model. Embeddings are needed too (see below) |
| Status | **Not chat only.** The chat and search requests carry an embedding model, which plugboard does not serve. Use a second provider for embeddings. docs-verified, not run (checked 2026-10-12) |

## Why chat alone is not enough

Vane's chat route validates the request body with a required `embeddingModel` (`embeddingModelSchema` in `src/app/api/chat/route.ts`). The search route does the same. Leaving the embedding model out is not an option the code accepts.

Plugboard serves chat, tools and images. It serves no `/v1/embeddings`. So Vane needs an embedding provider beside plugboard, for example a local embedding server or a hosted one. Pick that before you install.

## Plugboard options

Add the key and a chat alias to the plugin entry:

```jsonc
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "vane": "{env:PLUGBOARD_KEY_VANE}" },
    "models": ["opencode-go/glm-5.3-flash", "anthropic/claude-sonnet-4-6"],
    "aliases": {
      "answer": "anthropic/claude-sonnet-4-6"
    },
    "apps": { "vane": { "models": ["answer"] } }
  }
}
```

## Vane setup

Vane configures providers in its setup screen, not in a file. The OpenAI provider has two fields, from `providerConfigFields` in the source:

| Field | Value |
| --- | --- |
| API Key | The plugboard app key for Vane. The source names the env var `OPENAI_API_KEY` for this field |
| Base URL | `http://192.0.2.10:4010/v1`, ending in `/v1`. The source names the env var `OPENAI_BASE_URL` for this field |

Then, in the same provider:

1. Chat model: the plugboard alias `answer`, entered as the model key.
2. Embedding model: a model from the other provider. Do not use a plugboard alias here, because plugboard has no embedding route.

Run Vane with Docker as the README shows (`docker run -d -p 3000:3000 -v vane-data:/home/vane/data --name vane itzcrazykns1337/vane:latest`). Enter the two fields in the setup screen. Whether the env vars are read at start-up was not checked.

The README's troubleshooting for a local OpenAI-compatible server says to bind the server to `0.0.0.0`, use the exact model name, and put any non-empty value in the key field. Plugboard needs its app key, so the key is not a placeholder.

## What works and what does not

- **Answers**: through the `answer` alias, once the embedding model is set.
- **Search and uploads**: they send an embedding model too, so they need the second provider.
- **Model list**: Vane may list the models from `/v1/models` for a non-OpenAI base URL. Not checked.
- **Widgets, discover, and search sources**: not related to the LLM, so not checked against plugboard.

## Gotchas

- Vane has no authentication, according to its upcoming-features list ("Adding authentication"). Keep its port on loopback or a trusted network.
- The plugboard key goes in the setup screen or `OPENAI_API_KEY`. Do not put it in the image or the repo.

## Sources

- [Vane `providerConfigFields`, OpenAI provider](https://github.com/ItzCrazyKns/Vane/blob/348feca3e378fb4157b217724ed508dc707f853f/src/lib/models/providers/openai/index.ts) (read 2026-10-12)
- [Vane chat route, required `embeddingModel`](https://github.com/ItzCrazyKns/Vane/blob/348feca3e378fb4157b217724ed508dc707f853f/src/app/api/chat/route.ts) (read 2026-10-12)
- [Vane README](https://github.com/ItzCrazyKns/Vane/blob/348feca3e378fb4157b217724ed508dc707f853f/README.md) (read 2026-10-12)
