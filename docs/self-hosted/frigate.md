# Frigate

Frigate is a network video recorder with object detection. Its Generative AI feature writes object and review descriptions from snapshots, and offers a chat. Its semantic search is a separate feature that uses embeddings.

| | |
| --- | --- |
| Upstream | [blakeblackshear/frigate](https://github.com/blakeblackshear/frigate) (about 36.5k stars) |
| Config source | `docs/docs/configuration/genai/config.md` and `docs/docs/configuration/semantic_search.md` in the same repo |
| Plugboard API | `/v1/chat/completions`, with images |
| Status | Chat and descriptions work through plugboard. Semantic search needs a local embedding model. docs-verified, not run (checked 2026-10-11) |

## Plugboard options

```jsonc
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "frigate": "{env:PLUGBOARD_KEY_FRIGATE}" },
    "models": ["anthropic/claude-sonnet-4-6"],
    "aliases": { "vision": "anthropic/claude-sonnet-4-6" },
    "apps": { "frigate": { "models": ["vision"] } }
  }
}
```

`vision` must accept images, because Frigate's descriptions are image-based. Frigate's docs say "You must use a vision capable model". See [Remote access](../remote-access.md) for the bind and key requirements.

## Frigate config

Add a provider under `genai` in Frigate's `config.yml`:

```yaml
genai:
  plugboard:
    provider: openai
    base_url: http://host.docker.internal:4010/v1
    api_key: "{FRIGATE_PLUGBOARD_KEY}"
    model: vision
    roles:
      - chat
      - descriptions

semantic_search:
  enabled: true
  model: jinav1
  model_size: small
```

The provider name (`plugboard`) is yours to choose. `api_key` reads `FRIGATE_PLUGBOARD_KEY` from the environment, because Frigate expands `{FRIGATE_...}` variables. The key is the plugboard app key. Frigate's docs also say that `OPENAI_BASE_URL` in the environment sets the endpoint for an OpenAI-compatible provider. Either works. The `base_url` form is the one the config reference shows.

The `semantic_search` block uses Jina's CLIP model locally. It is not a GenAI provider. Frigate's docs say that the `embeddings` role "needs a different kind of model", so do not assign the `embeddings` role to the plugboard provider.

A runnable copy is in [`examples/self-hosted/frigate/`](https://github.com/jjjermiah/opencode-plugboard/blob/main/examples/self-hosted/frigate/README.md).

## What works and what does not

- **Descriptions** (`descriptions` role): images and text through the `vision` alias.
- **Chat** (`chat` role): text, and images if the chat sends them.
- **Semantic search**: local Jina CLIP through `semantic_search`. Plugboard serves no embeddings, so this stays local.
- **Audio**: not used.

## Gotchas

- Frigate's docs say cloud providers "require an active internet connection to send images and prompts". Plugboard sends the images to the provider your OpenCode server is signed in to, so the same applies.
- The image format decides how plugboard reads a snapshot. `data:` URLs always work. A plain `http(s)` image URL is fetched by plugboard only when `remoteImages` is on, and then only public addresses are fetched. Check which form Frigate sends before you turn `remoteImages` on.
- Frigate's Ollama section says a single model for Frigate and Home Assistant must support both vision and tools. This page did not test Frigate's chat with tools against plugboard.

## Sources

- [Generative AI configuration](https://github.com/blakeblackshear/frigate/blob/master/docs/docs/configuration/genai/config.md)
- [Semantic search](https://github.com/blakeblackshear/frigate/blob/master/docs/docs/configuration/semantic_search.md)
