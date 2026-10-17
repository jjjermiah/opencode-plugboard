# APIs

Every API uses the same keys, models, aliases, limits, history and usage. Pick the one your app speaks.

| API | Endpoints | Page |
| --- | --- | --- |
| OpenAI Chat Completions | `POST /v1/chat/completions` | [Chat Completions](chat-completions.md) |
| OpenAI Responses | `POST /v1/responses` | [Responses](responses.md) |
| Anthropic Messages | `POST /v1/messages`, `POST /v1/messages/count_tokens` | [Messages](messages.md) |
| Gemini | `POST /v1beta/models/{model}:generateContent`, `:streamGenerateContent`, `:countTokens` | [Gemini](gemini.md) |
| OpenAI legacy completions | `POST /v1/completions` | [Completions](completions.md) |
| Model list | `GET /v1/models`, `GET /v1/models/{id}`, `GET /v1beta/models` | each API page |

Plugboard's own routes live under `/plugboard/`: usage, status, metrics, the dashboard and key management. `/healthz` and `/readyz` answer health checks. See [History, usage and monitoring](guides/history-usage-and-monitoring.md).

## How a request runs

Each request becomes an OpenCode session in the app's own directory. OpenCode's normal request path calls the provider, so its logins, auth plugins and provider fixes all apply.

Plugboard replaces OpenCode's prompt, messages and tools with the caller's. The caller's tools become placeholder tools that do nothing. When the model calls one, plugboard stops the turn and returns the call to the caller. OpenCode never runs a caller's tool. Text streams out as it arrives. [Architecture](architecture.md) has the details.

## Known gaps

- **No server-side conversation state.** Every request carries the whole conversation. On Responses, `previous_response_id` and `conversation` are refused. The output items of recent answers are kept in memory for an hour, so `item_reference`s resolve; a restart clears them.
- **Anthropic structured outputs** (`output_config.format`) are refused with a 400. Use a [forced tool call](messages.md#structured-extraction-with-a-forced-tool), or `json_schema` on the OpenAI or Gemini APIs.
- **Gemini `candidateCount` above 1** is refused. The OpenAI APIs serve `n`.
- **Gemini model ids with `/` or `#`** are awkward in SDK URLs. Give clients an alias. See [Gemini](gemini.md#model-names).
- **State is per server.** Limits, the response cache and anchors live in one OpenCode server process. Two servers do not share them, and a restart clears limits and the cache.
- **Token counts and costs are estimates.** Plugboard has no tokenizer.
- **Not planned:** embeddings, audio, image generation and `logprobs`.
- **OpenCode V2 only.** V1 is not supported.
- **Early (0.x).** A minor release can change an option or a default. Read the [changelog](https://github.com/jjjermiah/opencode-plugboard/blob/main/CHANGELOG.md) before you upgrade.
