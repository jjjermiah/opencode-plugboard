# Anthropic Messages API

`POST /v1/messages` is served next to Chat Completions and Responses, with the same keys, model ids, aliases and limits. Use it when a client only speaks the Anthropic Messages API: the Anthropic SDKs, Claude Code, and agent tools built on them. They can then use any OpenCode provider through plugboard, including ChatGPT, Copilot and Go models.

Plugboard is stateless: every request carries the whole conversation in `messages`.

Tested with `@anthropic-ai/sdk` 0.133.0 against a fake model caller (plain, streamed and tool-loop calls, errors, both auth headers). Claude Code and the Python SDK were not run against it.

```ts
import Anthropic from "@anthropic-ai/sdk"

// baseURL has no /v1: the SDK adds /v1/messages itself.
const client = new Anthropic({ baseURL: "http://localhost:4010", apiKey: process.env.PLUGBOARD_KEY })
const m = await client.messages.create({ model: "fast", max_tokens: 256, messages: [{ role: "user", content: "Reply with exactly: pong" }] })
```

## Auth

Send the plugboard key as `x-api-key` (what the Anthropic SDKs do) or as `Authorization: Bearer` (what Claude Code does with `ANTHROPIC_AUTH_TOKEN`). Both check the same key store. If both headers are present and the bearer token is not a key, `x-api-key` is tried next. Without `keys` on a loopback listener no header is needed. `anthropic-version` and `anthropic-beta` are accepted and ignored.

## Claude Code

```sh
export ANTHROPIC_BASE_URL=http://localhost:4010
export ANTHROPIC_AUTH_TOKEN="$PLUGBOARD_KEY"   # any non-empty value on a keyless loopback listener
export ANTHROPIC_MODEL=claude-sonnet           # a plugboard alias or provider/model[#variant]
export ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-haiku
claude
```

Define the aliases in the plugboard `aliases` option (for example `"claude-sonnet": "anthropic/claude-sonnet-4-6"`), or pass full ids such as `anthropic/claude-sonnet-4-6`. Claude Code also sends background requests (titles, summaries) to its small model, so set `ANTHROPIC_DEFAULT_HAIKU_MODEL` (and `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL` if you switch with `/model`) to ids or aliases plugboard serves; otherwise those calls fail with 404 `not_found_error`. This setup has not been run against Claude Code; the SDK paths it uses are covered above.

## What is supported

| Request field | How it is handled |
| --- | --- |
| `model` | Same as Chat Completions: an alias or `provider/model[#variant]`. The response echoes the string you sent. |
| `max_tokens` | Required, a positive integer, passed to the model. |
| `system` | A string, or text blocks (`cache_control` is accepted and ignored). |
| `messages` | `user` and `assistant` turns with a string or content blocks: `text`, `image` (`base64` or `url` source), `document` (`base64`, `url` or `text` source), `tool_use` (assistant), `tool_result` (user). `thinking` and `redacted_thinking` blocks are accepted and dropped. `cache_control` is ignored. |
| `tool_result` | `content` as a string or text and image blocks, `is_error` passed on. Each result must answer a `tool_use` block from an earlier assistant turn. Images inside a result are passed as user media after the results. |
| `tools` | Custom tools with `name`, `description` and `input_schema`. |
| `tool_choice` | `auto`, `any`, `none`, `{"type":"tool","name":"..."}`. `disable_parallel_tool_use` is ignored. |
| `temperature`, `top_p` | Passed to the model, minus the ones the model is known to reject (see below). |
| `top_k` | Ignored. Plugboard has no `top_k` option. The response header `x-plugboard-dropped-params` lists it. |
| `stop_sequences` | Passed to the model. |
| `thinking`, `output_config.effort` | `thinking` is validated like Anthropic does (`budget_tokens` at least 1024 and below `max_tokens`). It picks a model variant when the model has one and the id carries none: `output_config.effort` names the variant directly, otherwise `budget_tokens` up to 4096 means `low`, up to 16384 `medium`, above that `high`. A model without that variant is called as is. With `enabled` or `adaptive` thinking, the model's reasoning text comes back as `thinking` blocks. |
| `stream` | The standard event sequence, below. |
| `metadata`, `service_tier`, `context_management`, `container` | Accepted and ignored. |

Sampling parameters follow the same `dropUnsupportedParams` rule as Chat Completions: parameters a model is known to reject are dropped and listed in `x-plugboard-dropped-params`.

## What is rejected

A 400 `invalid_request_error` whose message names the field, for example `tools.0.type: "web_search_20250305" is not supported`:

- Tools that are not custom tools: server tools (`web_search`, `web_fetch`, `code_execution`, ...) run on Anthropic's side, and the versioned `computer`, `bash` and `text_editor` tools are not available.
- `mcp_servers`, `output_config.format` (structured outputs).
- Content blocks plugboard cannot use: `server_tool_use`, `web_search_tool_result`, `mcp_tool_use`, `search_result`, files by `file_id`, and so on.
- A `tool_result` whose `tool_use_id` no earlier `tool_use` block has, and `tool_choice` naming a tool that is not in `tools`.
- A missing `max_tokens`, `messages` or `model`, values out of range, and more tools than the `maxTools` option.

`POST /v1/messages/count_tokens` answers `{ "input_tokens": N }` with an estimate: characters / 4 over the system prompt, messages and tool schemas, plus a fixed cost per image or file. Plugboard has no tokenizer for the model behind an id, so treat it as a budget hint, not the provider's exact count.

## Output

A message object: `id` (`msg_...`), `type: "message"`, `role: "assistant"`, `model`, `content` blocks in order (`thinking`, `text`, and one `tool_use` per call with an `id` starting `toolu_`), `stop_reason`, `stop_sequence` and `usage`.

| `stop_reason` | When |
| --- | --- |
| `end_turn` | The model stopped normally. |
| `tool_use` | The model called tools. |
| `max_tokens` | The model hit the token limit. |
| `refusal` | The provider filtered the content. |

`stop_reason: "stop_sequence"` is returned when the answer text ends with one of the request's `stop_sequences`. That sequence is removed from the text and given as `stop_sequence`. The host reports only that the turn stopped, so a sequence the provider ended on without returning it shows as `end_turn`, with `stop_sequence` `null`.

`usage` has `input_tokens`, `output_tokens` (including reasoning), `cache_read_input_tokens` and `cache_creation_input_tokens`. As in Anthropic's API, `input_tokens` excludes the cached tokens that the other two fields report. The `x-plugboard-session` header works as on Chat Completions, and every response carries a `request-id` header.

Errors use Anthropic's body, `{"type":"error","error":{"type":"...","message":"..."}}`, from the first check on (auth, origin, body, model, provider errors), with these types: `invalid_request_error` (400, 405, 415), `authentication_error` (401), `permission_error` (403), `not_found_error` (404), `request_too_large` (413), `rate_limit_error` (429), `timeout_error` (504), `overloaded_error` (529) and `api_error` for the rest.

## Streaming

`stream: true` sends SSE frames `event: <type>` then `data: <json>`:

```text
message_start                (usage is zero here: token counts are known at the end)
content_block_start          (thinking or text, one per block)
ping                         (once, after the first block starts)
content_block_delta          (thinking_delta or text_delta, one per model chunk)
content_block_stop
content_block_start          (tool_use with input {}, one per call)
content_block_delta          (one input_json_delta holding the whole input)
content_block_stop
message_delta                (stop_reason, and the final usage)
message_stop
```

Tool calls arrive whole from the model, so each call is a single `input_json_delta`. Thinking blocks carry an empty `signature`. Nothing is sent until there is output, so a failure before the first token is a real HTTP error. A failure after that ends the stream with an `event: error` frame (`{"type":"error","error":{"type","message"}}`) and no `message_stop`.
