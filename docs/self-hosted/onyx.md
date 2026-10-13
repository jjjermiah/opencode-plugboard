# Onyx

Onyx (formerly Danswer) is an enterprise search and chat app. Connectors index your documents. Chat answers with an LLM over that index. Indexing and search need embeddings, and plugboard serves none, so Onyx needs a second provider or its own local model for that role.

| | |
| --- | --- |
| Upstream | [onyx-dot-app/onyx](https://github.com/onyx-dot-app/onyx) (about 32k stars), commit [e89ebea](https://github.com/onyx-dot-app/onyx/tree/e89ebeaac40b2eb0a874ac4819b8946d3488c49b) |
| Config source | the admin UI, read from `web/src/sections/modals/languageModels/OpenAICompatibleModal.tsx` and `web/src/views/admin/IndexSettingsPage/`. Backend: `backend/onyx/llm/` and `backend/onyx/server/manage/llm/api.py`. Compose: `deployment/docker_compose/docker-compose.yml` |
| Plugboard API | `/v1/chat/completions` for the LLM role. `/v1/models` for the model list. No embeddings, reranking, images or speech |
| Status | **Chat only.** Answers run through plugboard. Indexing and search need an embedding model from somewhere else. docs-verified, not run (checked 2026-10-13) |

## Model roles

| Role | Used for | Served by |
| --- | --- | --- |
| LLM | Chat and answers | Plugboard, through the OpenAI-Compatible provider |
| Embedding | Indexing and search | Onyx's own model server by default (`nomic-ai/nomic-embed-text-v1`), or a cloud provider. Not plugboard |
| Reranker | Optional reordering of results | Not set by default. The env default `DEFAULT_CROSS_ENCODER_MODEL_NAME` is unset (`backend/shared_configs/configs.py`). Whether the admin defaults add one was not traced |
| Vision | Images in chat | Not checked |

## Plugboard options

Add the key and a text alias to the plugin entry:

```jsonc
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "onyx": "{env:PLUGBOARD_KEY_ONYX}" },
    "models": ["opencode-go/glm-5.3-flash", "anthropic/claude-sonnet-4-6"],
    "aliases": {
      "text": "opencode-go/glm-5.3-flash"
    },
    "apps": { "onyx": { "models": ["text"] } }
  }
}
```

Plugboard lists its aliases on `/v1/models`, and for an app key it lists only that app's `models` (`listAvailableModels` in `src/models.ts`). So `text` appears in Onyx's model list for this key.

## Onyx setup: the LLM

1. Open the Language Models admin page (`/admin/language-models`). Choose **OpenAI-Compatible**. Its form has an API base field, an API key field and a model list (`OpenAICompatibleModal.tsx`).
2. In the API base field, enter `http://192.0.2.10:4010/v1`. Onyx adds `/v1` when the base lacks it (`multi_llm.py`, around lines 658 to 661). It requests the model list from `<base>/models` (`_get_openai_compatible_server_response` in `api.py`, around line 2466), which is `/v1/models` here.
3. In the API key field, enter the plugboard app key. The field is optional in the form, but set it. When the key is empty, Onyx sends the placeholder `not-needed` (`multi_llm.py`, around lines 656 to 657). Plugboard refuses requests without a key once `keys` is set.
4. Fetch the models, select `text`, and mark it as the default LLM.

`openai_compatible` maps to the OpenAI chat-completions surface (`backend/onyx/llm/api_surfaces.py`), so chat requests go to `/chat/completions` under the base.

## Embedding and indexing

Plugboard cannot be the embedding provider. Three options, all outside plugboard:

- **Keep the default.** `DEFAULT_DOCUMENT_ENCODER_MODEL` is `nomic-ai/nomic-embed-text-v1` (`configs.py`). The compose file runs an `indexing_model_server` with a Hugging Face cache volume (`docker-compose.yml`). No external provider is needed. Whether the first start downloads that model was not traced; the cache volume suggests it does.
- **A cloud provider.** The embedding provider enum is `openai`, `cohere`, `voyage`, `google`, `litellm`, `azure` and `bifrost` (`backend/shared_configs/enums.py`). Add it under Index Settings (`/admin/index-settings`, the cloud-based tab).
- **A LiteLLM proxy or another gateway with `/v1/embeddings`.** The LiteLLM path sends `{"model", "input"}` to the API URL you enter, as given, and reads `data[].embedding` (`search_nlp_models.py`, around lines 626 to 651). Enter the full embeddings URL. The form field was not traced.

The Index Settings self-hosted tab does not take a URL. Its custom model asks only for a model name, a dimension and prefixes (`IndexSettingsPage/modals.tsx`), and runs on Onyx's model server.

## What works and what does not

- **Chat and answers through `text`**: works per the source. Not run.
- **Indexing and search**: need an embedding model. Plugboard has none to offer.
- **Reranking**: no plugboard role. Off by default.
- **Images in chat, image generation, speech**: not checked in Onyx. Plugboard's image input is data URLs only.

## Gotchas

- Onyx runs two model servers, `inference_model_server` and `indexing_model_server`, each with a Hugging Face cache (`docker-compose.yml`). Plan disk and network for the first start. Not measured.
- The API key field takes the plugboard app key, not an OpenAI key.
- A key's model list is limited to that app's `models`. If `text` is missing, check the app's `models` list in the plugboard config.
- Onyx's compose file and its model choices live in its repo. This page adds no env file or compose service here.

## Sources

- [Onyx `OpenAICompatibleModal.tsx` at e89ebea](https://github.com/onyx-dot-app/onyx/blob/e89ebeaac40b2eb0a874ac4819b8946d3488c49b/web/src/sections/modals/languageModels/OpenAICompatibleModal.tsx) (read 2026-10-13)
- [Onyx `backend/onyx/llm/api_surfaces.py` at e89ebea](https://github.com/onyx-dot-app/onyx/blob/e89ebeaac40b2eb0a874ac4819b8946d3488c49b/backend/onyx/llm/api_surfaces.py) (read 2026-10-13)
- [Onyx `backend/onyx/llm/multi_llm.py` at e89ebea](https://github.com/onyx-dot-app/onyx/blob/e89ebeaac40b2eb0a874ac4819b8946d3488c49b/backend/onyx/llm/multi_llm.py) (read 2026-10-13)
- [Onyx `backend/onyx/server/manage/llm/api.py` at e89ebea](https://github.com/onyx-dot-app/onyx/blob/e89ebeaac40b2eb0a874ac4819b8946d3488c49b/backend/onyx/server/manage/llm/api.py) (read 2026-10-13)
- [Onyx `backend/shared_configs/configs.py` at e89ebea](https://github.com/onyx-dot-app/onyx/blob/e89ebeaac40b2eb0a874ac4819b8946d3488c49b/backend/shared_configs/configs.py) (read 2026-10-13)
- [Onyx `backend/shared_configs/enums.py` at e89ebea](https://github.com/onyx-dot-app/onyx/blob/e89ebeaac40b2eb0a874ac4819b8946d3488c49b/backend/shared_configs/enums.py) (read 2026-10-13)
- [Onyx `backend/onyx/natural_language_processing/search_nlp_models.py` at e89ebea](https://github.com/onyx-dot-app/onyx/blob/e89ebeaac40b2eb0a874ac4819b8946d3488c49b/backend/onyx/natural_language_processing/search_nlp_models.py) (read 2026-10-13)
- [Onyx `deployment/docker_compose/docker-compose.yml` at e89ebea](https://github.com/onyx-dot-app/onyx/blob/e89ebeaac40b2eb0a874ac4819b8946d3488c49b/deployment/docker_compose/docker-compose.yml) (read 2026-10-13)
- [Onyx `IndexSettingsPage/modals.tsx` at e89ebea](https://github.com/onyx-dot-app/onyx/blob/e89ebeaac40b2eb0a874ac4819b8946d3488c49b/web/src/views/admin/IndexSettingsPage/modals.tsx) (read 2026-10-13)
