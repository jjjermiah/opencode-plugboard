# Frigate

Frigate is a network video recorder with object detection. Its Generative AI feature writes object and review descriptions from snapshots, and it has a chat.

## Plugboard options

Give Frigate its own key and a vision alias, because descriptions are image-based. Docker needs a reachable address ([Serving other machines](../guides/serving-other-machines.md)).

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

## Connect

Add a provider under `genai` in `config.yml`:

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

`plugboard` is a name you choose. Frigate expands `{FRIGATE_PLUGBOARD_KEY}` from the environment, so set it to the plugboard key. Do not give the provider the `embeddings` role.

A runnable copy is in [`examples/self-hosted/frigate/`](https://github.com/jjjermiah/opencode-plugboard/blob/main/examples/self-hosted/frigate/README.md).

## What works

- Descriptions (the `descriptions` role), from images and text.
- Chat (the `chat` role).

## Limits

- Semantic search stays on Frigate's local Jina model. Plugboard serves no embeddings.
- Plugboard reads `data:` image URLs. It fetches a plain `http(s)` image URL only when `remoteImages` is on, and then only public addresses. Turn it on only if Frigate sends URLs.
- Snapshots go to the provider your OpenCode server is signed in to, so they leave your network.
