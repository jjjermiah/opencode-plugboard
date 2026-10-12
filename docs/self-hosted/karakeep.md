# Karakeep

Karakeep saves bookmarks, pages and PDFs, and uses an LLM to tag them and, if you turn it on, to summarize them. This page covers the LLM side only.

| | |
| --- | --- |
| Upstream | [karakeep-app/karakeep](https://github.com/karakeep-app/karakeep) (about 29.6k stars) |
| Config source | `docs/docs/03-configuration/01-environment-variables.md` and `02-different-ai-providers.md` in the same repo |
| Plugboard API | `/v1/chat/completions`, with images for vision inference |
| Status | Works for tagging, summaries and image tagging. No embeddings. docs-verified, not run (checked 2026-10-11) |

## Plugboard options

Add the app key and a model alias to the plugin entry in `~/.config/opencode/opencode.jsonc`:

```jsonc
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

Use models you are signed in to. `vision` must accept images, because `INFERENCE_IMAGE_MODEL` sends them. Non-loopback `listen` needs `keys` and a restart. See [Remote access](../remote-access.md).

## Karakeep config

Karakeep reads `.env` through its compose file. Set these, with the plugboard app key:

```sh
OPENAI_API_KEY=<the karakeep app key>
OPENAI_BASE_URL=http://host.docker.internal:4010/v1
INFERENCE_TEXT_MODEL=tag
INFERENCE_IMAGE_MODEL=vision
SEMANTIC_SEARCH_ENABLED=false
```

`OPENAI_API_KEY` is the plugboard key, not an OpenAI key. The variable name is Karakeep's. With `OPENAI_BASE_URL` set, Karakeep turns embedding auto-indexing off by default (the variable table says it is on only for the default OpenAI settings). `SEMANTIC_SEARCH_ENABLED=false` also hides the hybrid and semantic search modes, which would otherwise need embeddings.

Karakeep's compose file has a `web` service. Add the host name for Linux in an override next to it:

```yaml
# docker-compose.override.yml
services:
  web:
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

A runnable copy is in [`examples/self-hosted/karakeep/`](https://github.com/jjjermiah/opencode-plugboard/blob/main/examples/self-hosted/karakeep/README.md).

## What works and what does not

- **Tagging** (`INFERENCE_ENABLE_AUTO_TAGGING`, on by default): text through `INFERENCE_TEXT_MODEL`.
- **Image tagging**: through `INFERENCE_IMAGE_MODEL`, which needs a vision model.
- **Summaries** (`INFERENCE_ENABLE_AUTO_SUMMARIZATION`, off by default): text. Turn it on if you want it.
- **Structured output**: `INFERENCE_OUTPUT_SCHEMA` defaults to `structured`, which sends `json_schema`. Plugboard answers that through a tool. Do not set `tools: false` for this app, because the policy would drop the schema (see [Per-app policy](../configuration.md#per-app-policy-apps)). If a model fails on structured output, set `INFERENCE_OUTPUT_SCHEMA=json`.
- **Semantic and hybrid search, related bookmarks**: need embeddings. Plugboard serves none. Leave them off, or point `EMBEDDING_OPENAI_BASE_URL` at an embedding provider you run yourself.
- **Audio**: not used.

## Gotchas

- `INFERENCE_CONTEXT_LENGTH` defaults to 2048 tokens. Longer pages are truncated before tagging, so raise it if tags come from the first lines only.
- A large backlog import sends many calls at once. Cap it with `limits.perApp.requestsPerMinute` on the `karakeep` app if the provider rate-limits.

## Sources

- [Environment variables, inference and embedding](https://github.com/karakeep-app/karakeep/blob/main/docs/docs/03-configuration/01-environment-variables.md)
- [Different AI providers](https://github.com/karakeep-app/karakeep/blob/main/docs/docs/03-configuration/02-different-ai-providers.md)
- [Docker install and compose file](https://github.com/karakeep-app/karakeep/blob/main/docker/docker-compose.yml)
