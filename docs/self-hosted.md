# Self-hosted apps

Self-hosted apps with an AI feature usually take a base URL, an API key and a model id. This page lists the ones checked against their current docs or source, and what plugboard can do for each.

Plugboard serves chat (Chat Completions, Responses, Anthropic Messages and Gemini), tools and images. It does not serve embeddings, audio (speech-to-text and text-to-speech) or image generation. Where an app needs those, plugboard can often serve its chat and another provider can serve the rest.

Status terms:

- **Works**: the app's AI features run through plugboard.
- **Chat only**: the chat features run through plugboard. Embeddings, speech or images need another provider.
- **Not possible**: the app's AI features cannot use plugboard.

Checked 2026-10-11. Statuses come from each app's docs or source, not from a live run, unless a page says it was run. Each page has its own sources and date. Stars are from the GitHub API on that day.

| App | What AI does there | Plugboard API | Status | Page or issue |
| --- | --- | --- | --- | --- |
| Karakeep (about 29.6k stars) | Tags, summaries, image tagging | Chat, vision | Works, no embeddings | [page](self-hosted/karakeep.md) |
| Frigate (about 36.5k) | Object descriptions, chat | Chat, vision | Chat only: semantic search uses a local Jina model | [page](self-hosted/frigate.md) |
| paperless-gpt (about 2.8k) | Titles, tags, correspondents, LLM OCR | Chat, vision | Works, no embeddings | [page](self-hosted/paperless-gpt.md) |
| Mealie (about 13.5k) | Recipe import from text, URLs and photos, AI parser | Chat, vision | Works, except video audio transcription | [page](self-hosted/mealie.md) |
| Khoj (about 37.6k) | Chat over your notes and the web | Chat | Chat only, search model not checked | [page](self-hosted/khoj.md) |
| Nextcloud Assistant (integration_openai) | Text, summaries, translation, image analysis | Chat, tools, vision | Chat only: no image generation or speech | [page](self-hosted/nextcloud-assistant.md) |
| Mattermost AI plugin (plugin repo, about 250 stars) | Chat assistants and agents | Responses or Chat Completions | Works | [page](self-hosted/mattermost.md) |
| Open Notebook (about 40.1k) | Notebook chat and transformations | Chat | Chat only: embeddings need another provider | [page](self-hosted/open-notebook.md) |
| Langflow (about 155.5k) | Language model components in flows | Chat | Chat only: the SSRF allowlist must include the host | [page](self-hosted/langflow.md) |
| SparkyFitness (owner's deployment) | AI assistant, with tools | Chat, tools | Works | [page](self-hosted/sparkyfitness.md) |
| paperless-ai (about 6.0k) | Classification, tags, RAG chat | Chat | Not checked: upstream is mid-rewrite | [#243](https://github.com/jjjermiah/opencode-plugboard/issues/243) |
| Vane, formerly Perplexica (about 37.3k) | Answering engine | Chat | Not checked: embedding need unknown | [#244](https://github.com/jjjermiah/opencode-plugboard/issues/244) |
| Onyx (about 32.4k) | RAG search and chat | Chat | Chat only expected: indexing needs embeddings | [#245](https://github.com/jjjermiah/opencode-plugboard/issues/245) |
| Tandoor Recipes (about 8.7k) | Recipe import, step sorting, nutrition | Chat, vision | Works for text import. Photo import needs a vision alias. JSON mode not checked | [page](self-hosted/tandoor.md) |
| LLM Vision for Home Assistant (about 1.5k) | Image and video analysis | Chat, vision | Not checked: provider form unverified | [#247](https://github.com/jjjermiah/opencode-plugboard/issues/247) |
| SiYuan (about 46.7k) | AI writing and Q/A | Chat | Works for writing and chat. Embeddings need another provider | [page](self-hosted/siyuan.md) |
| PR-Agent code review (about 13.4k) | Pull request review, describe, improve | Chat | Works through chat. Gitea and Forgejo not checked | [page](self-hosted/pr-agent.md) |
| RAGFlow (about 92k) | Document RAG | Chat | Chat only: embeddings and reranker need another provider | [#250](https://github.com/jjjermiah/opencode-plugboard/issues/250) |
| Home Assistant OpenAI Conversation (core) | Voice and conversation agent | None | Not possible: the core integration supports only the official OpenAI endpoint | Use [#237](https://github.com/jjjermiah/opencode-plugboard/issues/237) (Extended OpenAI Conversation) |
| Immich | No LLM feature: smart search and face recognition use local models | None | Not applicable | none |

Client apps such as [Dify #238](https://github.com/jjjermiah/opencode-plugboard/issues/238), [LibreChat #207](https://github.com/jjjermiah/opencode-plugboard/issues/207) and [AnythingLLM #211](https://github.com/jjjermiah/opencode-plugboard/issues/211) are tracked under the client epic [#206](https://github.com/jjjermiah/opencode-plugboard/issues/206). This page's tracking epic is [#251](https://github.com/jjjermiah/opencode-plugboard/issues/251).

## Networking from containers

Most of these apps run in Docker. Plugboard binds `127.0.0.1` by default, and a container cannot reach that address on the host. Set `listen.host` to a non-loopback address, set `keys`, and point the app at `http://host.docker.internal:4010/v1` (or the host's LAN address). On Linux, add `--add-host host.docker.internal:host-gateway`.

The full steps, the `Host` header check and the reverse-proxy and SSH-tunnel alternatives are in [Remote access](remote-access.md). For the setting pattern that every OpenAI-compatible app shares, see [Any OpenAI-compatible app](clients/any-app.md).
