# Vane (formerly Perplexica)

Vane is a self-hosted answering engine. It searches the web through SearXNG and answers with cited sources, using an LLM for the answer and an embedding model for ranking.

## Plugboard options

Plugboard serves the answer model only. Vane's chat and search requests also carry an embedding model, and plugboard has no `/v1/embeddings`. Pick a second provider for embeddings before you install.

Give Vane its own key and a chat alias. Docker needs a reachable address ([Serving other machines](../guides/serving-other-machines.md)).

```jsonc plugboard-options
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "vane": "{env:PLUGBOARD_KEY_VANE}" },
    "models": ["anthropic/claude-sonnet-4-6"],
    "aliases": { "answer": "anthropic/claude-sonnet-4-6" },
    "apps": { "vane": { "models": ["answer"] } }
  }
}
```

## Connect

Vane sets providers in its setup screen. The OpenAI provider has two fields:

| Field | Value |
| --- | --- |
| API Key | the `vane` key (env var `OPENAI_API_KEY`) |
| Base URL | `http://host.docker.internal:4010/v1`, ending in `/v1` (env var `OPENAI_BASE_URL`) |

Then set:

1. Chat model: the alias `answer`.
2. Embedding model: a model from your other provider, not a plugboard alias.

Run Vane with Docker:

```sh
docker run -d -p 3000:3000 -v vane-data:/home/vane/data --name vane itzcrazykns1337/vane:latest
```

## What works

Answers through the `answer` alias, once the embedding model is set.

## Limits

- Chat, search and uploads all need the embedding model from the second provider.
- Vane has no login. Keep its port on loopback or a trusted network.
- Enter the plugboard key in the setup screen or `OPENAI_API_KEY`. Do not bake it into an image or commit it.
