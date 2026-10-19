# Self-hosted apps

Self-hosted apps with an AI feature usually take a base URL, an API key and a model id. This page lists the apps with a setup guide and what plugboard does for each.

Plugboard serves chat (Chat Completions, Responses, Anthropic Messages and Gemini), tools and images. It does not serve embeddings, speech or image generation. Where an app needs those, plugboard serves its chat and another provider serves the rest.

| App | What AI does | Plugboard API | What works |
| --- | --- | --- | --- |
| [Karakeep](self-hosted/karakeep.md) | Tags, summaries, image tagging | Chat, vision | All of it. Semantic search needs embeddings elsewhere |
| [Frigate](self-hosted/frigate.md) | Object descriptions, chat | Chat, vision | Descriptions and chat. Semantic search stays on its local model |
| [paperless-gpt](self-hosted/paperless-gpt.md) | Titles, tags, correspondents, LLM OCR | Chat, vision | All of it |
| [Mealie](self-hosted/mealie.md) | Recipe import from text, URLs and photos, ingredient parser | Chat, vision | All except video transcription |
| [Khoj](self-hosted/khoj.md) | Chat over your notes and the web | Chat | Chat. Embeddings, if its search needs them, come from elsewhere |
| [Nextcloud Assistant](self-hosted/nextcloud-assistant.md) | Text tasks, summaries, translation, image analysis | Chat, tools, vision | Text, tools and vision. Image generation and speech come from elsewhere |
| [Mattermost AI plugin](self-hosted/mattermost.md) | Chat assistants and agents | Responses or Chat Completions | Chat and agents |
| [Open Notebook](self-hosted/open-notebook.md) | Notebook chat and transformations | Chat | Chat. Embeddings for sources come from elsewhere |
| [Langflow](self-hosted/langflow.md) | Language model components in flows | Chat | Language model components. Embedding components need another provider |
| [SparkyFitness](self-hosted/sparkyfitness.md) | AI assistant with tools | Chat, tools | All of it |
| [paperless-ai](self-hosted/paperless-ai.md) | Titles, tags, correspondents, RAG chat | Chat | Suggestions and chat. The RAG index is local |
| [Vane](self-hosted/vane.md) | Answering engine | Chat | Answers. It also needs an embedding provider |
| [Onyx](self-hosted/onyx.md) | RAG search and chat | Chat | Chat. Indexing needs an embedding model elsewhere |
| [Tandoor Recipes](self-hosted/tandoor.md) | Recipe import, step sorting, nutrition | Chat, vision | Text and photo import. PDF import fails |
| [LLM Vision for Home Assistant](self-hosted/llm-vision.md) | Image and video analysis | Chat, vision | Vision through the Custom OpenAI provider |
| [SiYuan](self-hosted/siyuan.md) | AI writing and Q/A | Chat | Writing, chat and the agent. Semantic search needs embeddings elsewhere |
| [PR-Agent](self-hosted/pr-agent.md) | Pull request review, describe, improve | Chat | `/review` of a local branch. The other commands send the same kind of chat request |
| [RAGFlow](self-hosted/ragflow.md) | Document RAG | Chat | Chat. Dataset embeddings and reranking come from elsewhere |
| Home Assistant OpenAI Conversation (core) | Voice and conversation agent | None | The core integration only accepts the official OpenAI endpoint. Use [Extended OpenAI Conversation](clients/home-assistant-extended-openai.md) |
| Immich | No LLM feature. Smart search and face recognition use local models | None | Not applicable |

Chat clients such as [Dify](clients/dify.md) and [LibreChat](clients/librechat.md) have their own pages. For any other OpenAI-compatible app, see [Any OpenAI-compatible app](clients/any-app.md).

## Networking from containers

Plugboard binds `127.0.0.1` by default, and a container cannot reach that address on the host. Set `listen.host` to a reachable address, set `keys`, and point the app at `http://host.docker.internal:4010/v1`. On Linux, add `--add-host host.docker.internal:host-gateway`. The steps, reverse proxies and tunnels are in [Serving other machines](guides/serving-other-machines.md).
