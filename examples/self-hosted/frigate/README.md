# Frigate with plugboard

Adds a GenAI provider to Frigate that points at plugboard, for descriptions and chat. Semantic search stays on the local Jina model. Full notes are in [docs/self-hosted/frigate.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/self-hosted/frigate.md). Docs-verified, not run.

## 1. Plugboard

Add the `frigate` key and the `vision` alias from the page's plugboard options block to `~/.config/opencode/opencode.jsonc`. Bind a non-loopback address and set `keys`, then restart OpenCode.

## 2. Frigate

Merge `config.yml` into Frigate's `config/config.yml`. Keep your cameras and detectors. Only the `genai` and `semantic_search` blocks are new.

Give Frigate the key through its environment, because `api_key` reads `{FRIGATE_PLUGBOARD_KEY}`. In your Frigate compose file, under the Frigate service:

```yaml
services:
  frigate:
    environment:
      FRIGATE_PLUGBOARD_KEY: ${PLUGBOARD_KEY_FRIGATE:?set PLUGBOARD_KEY_FRIGATE}
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

Then `docker compose up -d` as usual.

## 3. Check

```sh
curl -s http://127.0.0.1:4010/healthz
curl -s http://127.0.0.1:4010/v1/models -H "Authorization: Bearer $PLUGBOARD_KEY_FRIGATE"
```

Open a review item in Frigate and generate a description. Look at plugboard's request log line for the `frigate` app.
