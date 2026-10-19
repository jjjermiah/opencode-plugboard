# Karakeep

Karakeep saves bookmarks, pages and PDFs. An LLM tags them and, if you turn it on, summarizes them.

## Plugboard options

Give Karakeep its own key and two aliases. `vision` must accept images, because `INFERENCE_IMAGE_MODEL` sends them. Docker needs a reachable address ([Serving other machines](../guides/serving-other-machines.md)).

```jsonc plugboard-options
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "karakeep": "{env:PLUGBOARD_KEY_KARAKEEP}" },
    "models": ["opencode-go/glm-5.3-flash", "anthropic/claude-sonnet-4-6"],
    "aliases": {
      "tag": "opencode-go/glm-5.3-flash",
      "vision": "anthropic/claude-sonnet-4-6"
    },
    "apps": { "karakeep": { "models": ["tag", "vision"] } }
  }
}
```

## Connect

Set these in the `.env` that Karakeep's compose file reads:

```sh
OPENAI_API_KEY=<the karakeep key>
OPENAI_BASE_URL=http://host.docker.internal:4010/v1
INFERENCE_TEXT_MODEL=tag
INFERENCE_IMAGE_MODEL=vision
SEMANTIC_SEARCH_ENABLED=false
```

`OPENAI_API_KEY` takes the plugboard key. `SEMANTIC_SEARCH_ENABLED=false` hides the semantic and hybrid search modes, which need embeddings.

On Linux, add the host name to the `web` service in `docker-compose.override.yml`:

```yaml
services:
  web:
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

A runnable copy is in [`examples/self-hosted/karakeep/`](https://github.com/jjjermiah/opencode-plugboard/blob/main/examples/self-hosted/karakeep/README.md).

## What works

- Tagging, with `INFERENCE_TEXT_MODEL`. It is on by default.
- Image tagging, with `INFERENCE_IMAGE_MODEL`.
- Summaries, with `INFERENCE_ENABLE_AUTO_SUMMARIZATION=true`.
- Structured output. `INFERENCE_OUTPUT_SCHEMA` defaults to `structured`, and plugboard answers it through a tool.

## Limits

- Semantic search, hybrid search and related bookmarks need embeddings, which plugboard does not serve. Leave them off, or point `EMBEDDING_OPENAI_BASE_URL` at an embedding provider you run.
- Keep `tools` on for this app. A `tools: false` policy drops the schema ([Per-app policy](../configuration.md#per-app-policy-apps)). If a model fails on structured output, set `INFERENCE_OUTPUT_SCHEMA=json`.
- `INFERENCE_CONTEXT_LENGTH` defaults to 2048 tokens, so long pages are cut before tagging. Raise it.
- A large import sends many calls at once. Set `limits.perApp.requestsPerMinute` on the `karakeep` app if your provider rate-limits.
