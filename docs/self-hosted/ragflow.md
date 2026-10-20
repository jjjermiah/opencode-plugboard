# RAGFlow

RAGFlow is a RAG engine. It parses and chunks your documents, stores vectors per chunk, and answers questions with chat over the retrieved chunks. You set models in the web UI.

Upstream: [source](https://github.com/infiniflow/ragflow), [docs](https://ragflow.io/docs/).

## Plugboard options

Plugboard serves the LLM role. Every dataset needs an embedding model, and plugboard serves none, so RAGFlow needs a second provider for that.

| Role | Served by |
| --- | --- |
| LLM | Plugboard, through the OpenAI-API-Compatible provider |
| Embedding (required) | Another provider |
| Rerank (optional) | Another provider |

Give RAGFlow its own key and a chat alias. Docker needs a reachable address ([Serving other machines](../guides/serving-other-machines.md)).

```jsonc plugboard-options
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "ragflow": "{env:PLUGBOARD_KEY_RAGFLOW}" },
    "models": ["anthropic/claude-sonnet-4-6"],
    "aliases": { "chat": "anthropic/claude-sonnet-4-6" },
    "apps": { "ragflow": { "allowedModels": ["chat"] } }
  }
}
```

## Connect

### The LLM

1. Open **User settings**, **Model providers**, and choose **OpenAI-API-Compatible**.
2. Create an instance. Enter the `ragflow` key as the **API Key** and `http://host.docker.internal:4010/v1` as the **Base URL**. The `/v1` is required. Save and verify.
3. Add a custom model named `chat`, the plugboard alias. Choose the **LLM** type and set **Max tokens**. Turn on **Tool call** only if the model behind the alias supports tools. The alias may not appear in the auto-listed models, so add it by hand.
4. Under **Set default models**, set `chat` as the default LLM.

### The embedding model

Add a second provider instance for an embeddings endpoint, such as a local server or a hosted one. The same **OpenAI-API-Compatible** card works if that server speaks `/v1/embeddings`. Add the model with the **Embedding** type and set it as the default embedding model.

Pick the embedding model before you index. Changing it after parsing affects existing indexes.

### Reranking (optional)

Retrieval reranks only when you set a rerank model. Configure another provider for it. Plugboard has no rerank route.

## What works

- Chat and answers through the `chat` alias.
- Streaming with usage.

## Limits

- Uploading, indexing and retrieval need the embedding provider.
- The **Thinking** toggle does nothing through plugboard. Leave it off.
- Keep `dropUnsupportedParams` on. RAGFlow can send `temperature` and `top_p` together. A Claude 4.6 or older model takes only one of them, so plugboard drops `top_p` and lists it in `x-plugboard-dropped-params`.
- Speech models (ASR, TTS) are not served.
