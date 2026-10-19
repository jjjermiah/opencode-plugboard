# Onyx

Onyx (formerly Danswer) is an enterprise search and chat app. Connectors index your documents, and chat answers with an LLM over that index.

Upstream: [source](https://github.com/onyx-dot-app/onyx), [docs](https://docs.onyx.app/welcome).

## Plugboard options

Plugboard serves the LLM role. Indexing and search need an embedding model, which plugboard does not serve, so Onyx uses its own local model or a cloud provider for that.

| Role | Served by |
| --- | --- |
| LLM (chat and answers) | Plugboard, through the OpenAI-Compatible provider |
| Embedding (indexing and search) | Onyx's own model server (`nomic-ai/nomic-embed-text-v1` by default), or a cloud provider |
| Reranker | Optional, not served by plugboard |

Give Onyx its own key and a text alias. Docker needs a reachable address ([Serving other machines](../guides/serving-other-machines.md)).

```jsonc plugboard-options
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "onyx": "{env:PLUGBOARD_KEY_ONYX}" },
    "models": ["opencode-go/glm-5.3-flash"],
    "aliases": { "text": "opencode-go/glm-5.3-flash" },
    "apps": { "onyx": { "models": ["text"] } }
  }
}
```

An app key's model list shows only that app's `models`, so `text` appears in Onyx's list.

## Connect

1. Open **Language Models** in the admin area (`/admin/language-models`) and choose **OpenAI-Compatible**.
2. Set the API base to `http://host.docker.internal:4010/v1`. Onyx adds `/v1` if it is missing and reads the model list from `<base>/models`.
3. Enter the `onyx` key in the API key field. Leave it set: with an empty field Onyx sends a placeholder, and plugboard refuses it.
4. Fetch the models, select `text`, and mark it as the default LLM.

## What works

Chat and answers through the `text` alias.

## Limits

- Plugboard cannot be the embedding provider. Keep Onyx's default local model, add a cloud provider under **Index Settings** (`/admin/index-settings`), or point Onyx at a LiteLLM proxy or another gateway with `/v1/embeddings`.
- Onyx runs two model servers, each with a Hugging Face cache. Plan disk and network for the first start.
- Plugboard takes `data:` image URLs by default. It fetches `http(s)` image URLs only with `remoteImages` on.
- If `text` is missing from the model list, check the app's `models` list.
