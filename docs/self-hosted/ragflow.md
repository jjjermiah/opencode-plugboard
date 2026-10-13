# RAGFlow

RAGFlow is a RAG engine for document understanding and retrieval. It parses and chunks your documents, stores vectors for each chunk, and answers questions with chat over the retrieved chunks. Every dataset needs an embedding model, and plugboard serves none, so RAGFlow needs a second provider for that role.

| | |
| --- | --- |
| Upstream | [infiniflow/ragflow](https://github.com/infiniflow/ragflow) (about 92k stars), commit [ae1d8fb](https://github.com/infiniflow/ragflow/tree/ae1d8fb1e646ec62ae962038c27c276f2c7f5675) |
| Config source | `conf/models/openai-api-compatible.json`, `internal/entity/models/openai_api_compatible.go`, `internal/entity/models/base_model.go` and `internal/entity/models/vllm.go` at that commit. Docs: `docs/guides/models/llm_api_key_setup.md`, `docs/guides/dataset/dataset_list_and_creation.md` and `docs/faq.mdx` |
| Plugboard API | `/v1/chat/completions` for the LLM role |
| Status | **Chat only.** The LLM role runs through plugboard. Dataset embeddings need another provider. Reranking is optional and also needs another provider. docs-verified, not run (checked 2026-10-13) |

RAGFlow configures models in its web UI, not in a file. The UI path is **Model providers**, from the user menu.

## Model roles

| Role | Needed | Served by |
| --- | --- | --- |
| LLM | Yes (the default LLM) | Plugboard, through the OpenAI-API-Compatible provider |
| Embedding | Yes. A dataset needs one | Another provider. Plugboard has no `/v1/embeddings` |
| Rerank | Optional. Recommended if you configure one | Another provider. Plugboard has no `/v1/rerank` |
| VLM, ASR, TTS, OCR | As your use needs | Not checked |

The docs' minimum is a default LLM and a default embedding model (`llm_api_key_setup.md`, section "Set Default Models").

## Plugboard options

Add the key and a chat alias to the plugin entry:

```jsonc
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "ragflow": "{env:PLUGBOARD_KEY_RAGFLOW}" },
    "models": ["opencode-go/glm-5.3-flash", "anthropic/claude-sonnet-4-6"],
    "aliases": {
      "chat": "anthropic/claude-sonnet-4-6"
    },
    "apps": { "ragflow": { "models": ["chat"] } }
  }
}
```

## RAGFlow setup: the LLM

1. Open **User settings** > **Model providers**. Choose **OpenAI-API-Compatible** (`docs/faq.mdx` names this card for compatible APIs).
2. Create an instance. Enter the plugboard app key as the **API Key** and `http://192.0.2.10:4010/v1` as the **Base URL**. Save, then verify the connection. The docs say to confirm whether the path must include `/v1`. For plugboard it must.
3. Add a custom model named `chat`, the plugboard alias. The name must match the model ID the provider exposes (`llm_api_key_setup.md`, "Add a Custom Model"). Choose the **LLM** type, and set **Max tokens**. Enable **Tool call** only if the upstream model behind the alias supports tools.
4. Set `chat` as the default LLM under **Set default models**.

The driver builds the chat URL by joining the base to `chat/completions` with a `/` (`openai_api_compatible.go`, around line 96). So a base without `/v1` sends requests to the wrong path. Streaming sends `stream_options.include_usage` (around line 131), which plugboard supports.

Auto-listed models are filtered by name-based type inference (`ListModels` in `openai_api_compatible.go`, using `InferModelTypes`). An alias such as `chat` may not appear in the list. Add it as a custom model, as in step 3.

## RAGFlow setup: the embedding model

Plugboard cannot serve this role. Add a second model provider instance for an embeddings endpoint: a local server, or a hosted one. The same **OpenAI-API-Compatible** card works if that server speaks OpenAI's `/v1/embeddings`. Its URL map sets the embedding route to `embeddings` (`conf/models/openai-api-compatible.json`).

Then add the embedding model with the **Embedding** type, and set it as the default embedding model. When you create a dataset, you pick an embedding model from the list (`docs/guides/dataset/dataset_list_and_creation.md`). A dataset's embedding setting is rejected when it is empty (`internal/service/dataset/embedding.go`, around line 57).

## Reranking (optional)

Retrieval uses a rerank model only when one is set (`rerank_id` and `tenant_rerank_id` in `internal/service/chunk/chunk.go`, around lines 392 to 402). The chat defaults `rerank_id` to empty (`internal/service/chat.go`, around line 319). If you want reranking, configure another provider and set a default rerank model. Plugboard has no rerank route.

## What works and what does not

- **Chat and answers through `chat`**: works per the source. Not run.
- **Uploading and indexing**: need the embedding provider.
- **Retrieval**: needs the embedding provider. Reranking is off unless set.
- **Thinking**: when the chat config sets `Thinking`, RAGFlow adds a `thinking` object to the request. For names containing `qwen3`, it adds `chat_template_kwargs` (`vllm.go`, lines 57 to 87). Plugboard's handling of those fields was not checked. Leave Thinking off for the plugboard alias.
- **Images for the VLM role**: not checked.
- **Speech (ASR, TTS)**: plugboard serves no audio.

## Gotchas

- **The base URL needs `/v1`.** The driver adds `chat/completions` straight onto the base (see above).
- **The model name must match the alias.** `chat` is what RAGFlow sends as the model.
- **Pick the embedding model before indexing.** The docs say that changing it after parsing affects existing indexes (`docs/guides/dataset/dataset_overview.md`, around line 28).
- **Plugboard keys go in the API Key field.** Do not put an OpenAI key there.

## Sources

- [RAGFlow `conf/models/openai-api-compatible.json` at ae1d8fb](https://github.com/infiniflow/ragflow/blob/ae1d8fb1e646ec62ae962038c27c276f2c7f5675/conf/models/openai-api-compatible.json) (read 2026-10-13)
- [RAGFlow `internal/entity/models/openai_api_compatible.go` at ae1d8fb](https://github.com/infiniflow/ragflow/blob/ae1d8fb1e646ec62ae962038c27c276f2c7f5675/internal/entity/models/openai_api_compatible.go) (read 2026-10-13)
- [RAGFlow `internal/entity/models/vllm.go` at ae1d8fb](https://github.com/infiniflow/ragflow/blob/ae1d8fb1e646ec62ae962038c27c276f2c7f5675/internal/entity/models/vllm.go) (read 2026-10-13)
- [RAGFlow `internal/entity/models/base_model.go` at ae1d8fb](https://github.com/infiniflow/ragflow/blob/ae1d8fb1e646ec62ae962038c27c276f2c7f5675/internal/entity/models/base_model.go) (read 2026-10-13)
- [RAGFlow `internal/service/dataset/embedding.go` at ae1d8fb](https://github.com/infiniflow/ragflow/blob/ae1d8fb1e646ec62ae962038c27c276f2c7f5675/internal/service/dataset/embedding.go) (read 2026-10-13)
- [RAGFlow `docs/guides/models/llm_api_key_setup.md` at ae1d8fb](https://github.com/infiniflow/ragflow/blob/ae1d8fb1e646ec62ae962038c27c276f2c7f5675/docs/guides/models/llm_api_key_setup.md) (read 2026-10-13)
- [RAGFlow `docs/guides/dataset/dataset_list_and_creation.md` at ae1d8fb](https://github.com/infiniflow/ragflow/blob/ae1d8fb1e646ec62ae962038c27c276f2c7f5675/docs/guides/dataset/dataset_list_and_creation.md) (read 2026-10-13)
