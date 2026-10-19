# APIs

Every API uses the same keys, models, aliases, limits, history and usage. Pick the one your app speaks.

| API | Endpoints | Page |
| --- | --- | --- |
| OpenAI Chat Completions | `POST /v1/chat/completions` | [Chat Completions](chat-completions.md) |
| OpenAI Responses | `POST /v1/responses`, `GET` and `DELETE /v1/responses/{id}`, `GET /v1/responses/{id}/input_items` | [Responses](responses.md) |
| Anthropic Messages | `POST /v1/messages`, `POST /v1/messages/count_tokens` | [Messages](messages.md) |
| Gemini | `POST /v1beta/models/{model}:generateContent`, `:streamGenerateContent`, `:countTokens` | [Gemini](gemini.md) |
| OpenAI legacy completions | `POST /v1/completions` | [Completions](completions.md) |
| Files | `/v1/files` (OpenAI and Anthropic shapes), `POST /upload/v1beta/files` and `/v1beta/files` (Gemini) | [Files API](files.md) |
| Model list | `GET /v1/models`, `GET /v1/models/{id}`, `GET /v1beta/models` | each API page |

Plugboard's own routes live under `/plugboard/`: usage, status, metrics, the dashboard and key management. `/healthz` and `/readyz` answer health checks. See [History, usage and monitoring](guides/history-usage-and-monitoring.md).

## List the models a key can use

`PLUGBOARD_BASE_URL` is `http://127.0.0.1:4010/v1` and `PLUGBOARD_KEY` is your key. Every curl example is in [examples/curl/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/curl).

<<< @/../examples/curl/models.sh#snippet

## How a request runs

Each request becomes an OpenCode session in the app's own directory. OpenCode's normal request path calls the provider, so its logins, auth plugins and provider fixes all apply.

Plugboard replaces OpenCode's prompt, messages and tools with the caller's. The caller's tools become placeholder tools that do nothing. When the model calls one, plugboard stops the turn and returns the call to the caller. OpenCode never runs a caller's tool. Text streams out as it arrives. [Architecture](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/architecture.md) has the details.

## Conversation state

Chat Completions, Messages, Gemini and legacy completions carry the whole conversation in every request. Only Responses keeps state on the server: `previous_response_id` continues a stored answer. See [Responses](responses.md#stored-responses).

<a id="known-gaps"></a>

## Not supported

- **`conversation` on Responses.** Use `previous_response_id`, or send the full `input`.
- **Provider-hosted tools.** Web search, code execution, file search, computer use and MCP servers run on the provider's side. Plugboard only hands your function calls back to you.
- **Embeddings, audio, image generation and `logprobs`.**
- **Batch, fine-tuning, Assistants and vector stores.** The [Files API](files.md) stores a file to put it in a prompt, nothing else. Gemini `gs://` files are refused too.
- **OpenCode V1.** Plugboard needs OpenCode V2.

## Good to know

- **Gemini model ids with `/` or `#`** do not fit SDK URLs. Give clients an alias. See [Gemini](gemini.md#model-names).
- **State is per server.** Limits, the response cache and anchors live in one OpenCode server process. Two servers do not share them, and a restart clears limits and the cache.
- **Token counts and costs are estimates.** Plugboard has no tokenizer.
- **Plugboard is 0.x.** A minor release can change an option or a default. Read the [changelog](https://github.com/jjjermiah/opencode-plugboard/blob/main/CHANGELOG.md) before you upgrade.
