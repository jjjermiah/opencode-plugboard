# paperless-ai

paperless-ai runs beside paperless-ngx. It suggests titles, tags, correspondents and document dates with an LLM, and it has a chat over your documents. It is a separate container that reads and writes paperless-ngx through its API.

| | |
| --- | --- |
| Upstream | [clusterzx/paperless-ai](https://github.com/clusterzx/paperless-ai) (about 6.0k stars) |
| Config source | `.env.example`, `config/config.js`, `services/customService.js`, `services/chatService.js`, `services/ragService.js` and `main.py` at [d2fda69](https://github.com/clusterzx/paperless-ai/tree/d2fda6991e5e55d51d6473997176bb8d054f61fd). That commit is the current `main` head |
| Plugboard API | `/v1/chat/completions`, text only |
| Status | **Chat only.** Suggestions and chat go through plugboard as text. No images are sent. No embeddings: the RAG index uses a local model. docs-verified, not run (checked 2026-10-13) |

The upstream README says the author is rewriting the codebase and may not finish it (README, lines 10 and 11). This page describes the code at `d2fda69`. Check it again before you upgrade.

## Plugboard options

Add the key and a text alias to the plugin entry:

```jsonc
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "paperless-ai": "{env:PLUGBOARD_KEY_PAPERLESS_AI}" },
    "models": ["opencode-go/glm-5.3-flash", "anthropic/claude-sonnet-4-6"],
    "aliases": {
      "text": "opencode-go/glm-5.3-flash"
    },
    "apps": { "paperless-ai": { "models": ["text"] } }
  }
}
```

`text` handles suggestions, chat and RAG answers. No vision alias is needed, because the app does not send images.

## paperless-ai config

paperless-ai reads its settings from environment variables and from `data/.env` in its data volume. The fields for a custom OpenAI-compatible provider, from `.env.example` and `config/config.js`:

```sh
AI_PROVIDER=custom
CUSTOM_BASE_URL=http://host.docker.internal:4010/v1
CUSTOM_API_KEY=<the paperless-ai app key>
CUSTOM_MODEL=text
PAPERLESS_API_URL=http://<paperless-ngx host>:8000/api
PAPERLESS_API_TOKEN=<your paperless-ngx API token>
```

`CUSTOM_BASE_URL` ends in `/v1`. `customService.js` passes it as the `baseURL` of the OpenAI SDK client, and the SDK appends `/chat/completions`. `CUSTOM_API_KEY` is the plugboard app key, not an OpenAI key.

A runnable copy is in [`examples/self-hosted/paperless-ai/`](https://github.com/jjjermiah/opencode-plugboard/blob/main/examples/self-hosted/paperless-ai/README.md).

## What is sent through plugboard

- **Document analysis.** `customService.analyzeDocument` sends one `chat.completions.create` call with the system prompt and the document text. It uses `model: CUSTOM_MODEL` and `temperature: 0.3`. It sends no `response_format`. The answer is the JSON text, which the code parses after it strips ```` ```json ```` fences.
- **Thumbnail.** The same function fetches the document thumbnail from paperless-ngx and caches it under `public/images`. The thumbnail is not put in the request. No image reaches plugboard.
- **Chat.** `services/chatService.js` has a `custom` branch that streams (`stream: true`) with `CUSTOM_BASE_URL`, `CUSTOM_API_KEY` and `CUSTOM_MODEL`.
- **RAG.** `services/ragService.js` calls the AI provider for the answer only. Retrieval runs in the Python RAG service. `main.py` loads `paraphrase-multilingual-MiniLM-L12-v2` for embeddings and `cross-encoder/ms-marco-MiniLM-L-6-v2` for reranking, both with sentence-transformers, and keeps the vectors in ChromaDB. Nothing in that path calls plugboard.
- **Playground and status check.** `generateText` sends `max_tokens: 128000` (`customService.js`, `generateText`). `checkStatus` sends a `Ping` with `max_tokens: 1000`. Whether a model accepts 128000 depends on the model. Not traced through plugboard.

## What works and what does not

- **Suggestions** (title, tags, correspondent, document date, language): work through `text`. The code expects a JSON object in the reply. If the model adds text around it, the document gets no suggestion, and the log shows `Invalid JSON response from API`.
- **Chat (streaming)**: works through `text`.
- **RAG answers**: the answer uses `text`. Retrieval is local, so the index needs no plugboard embedding route. The first start downloads the two models from Hugging Face (`SentenceTransformer(EMBEDDING_MODEL_NAME)` and `CrossEncoder(...)` in `main.py`). A host with no Hugging Face access needs them cached first.
- **Vision**: not used. The custom provider never sends an image.
- **Embeddings and reranking**: not sent to plugboard.
- **JSON mode**: not requested. Plugboard's `json_object` and `json_schema` are not used by this app.

## Gotchas

- **Setting precedence.** The app loads `data/.env` with dotenv (`config/config.js`). dotenv does not overwrite a variable that is already set in the process environment. The compose `env_file` sets the same variables in the container, so a value you change in the web UI is ignored while the `.env` value is set. Change it in `.env` and recreate the container. This follows dotenv's default behaviour; not run.
- **Open setup.** With `PAPERLESS_AI_INITIAL_SETUP=yes`, the setup route stays open until setup is done (`routes/setup.js`, around lines 177 to 179). The upstream compose publishes the port on all interfaces. The example binds it to loopback instead.
- **Upstream may change.** The README says the rewrite may replace this codebase. Pin the image to a tag or digest you have tested.

## Sources

- [paperless-ai `.env.example` at d2fda69](https://github.com/clusterzx/paperless-ai/blob/d2fda6991e5e55d51d6473997176bb8d054f61fd/.env.example) (read 2026-10-13)
- [paperless-ai `services/customService.js` at d2fda69](https://github.com/clusterzx/paperless-ai/blob/d2fda6991e5e55d51d6473997176bb8d054f61fd/services/customService.js) (read 2026-10-13)
- [paperless-ai `config/config.js` at d2fda69](https://github.com/clusterzx/paperless-ai/blob/d2fda6991e5e55d51d6473997176bb8d054f61fd/config/config.js) (read 2026-10-13)
- [paperless-ai `services/chatService.js` at d2fda69](https://github.com/clusterzx/paperless-ai/blob/d2fda6991e5e55d51d6473997176bb8d054f61fd/services/chatService.js) (read 2026-10-13)
- [paperless-ai `main.py` at d2fda69](https://github.com/clusterzx/paperless-ai/blob/d2fda6991e5e55d51d6473997176bb8d054f61fd/main.py) (read 2026-10-13)
- [paperless-ai README](https://github.com/clusterzx/paperless-ai/blob/d2fda6991e5e55d51d6473997176bb8d054f61fd/README.md) (read 2026-10-13)
