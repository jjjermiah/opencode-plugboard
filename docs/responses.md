# Responses API

`POST /v1/responses` is served next to Chat Completions, with the same keys, model ids, aliases and limits. Use it when a client only speaks Responses: the Vercel AI SDK's `openai(id)`, `@langchain/openai` for ids such as `gpt-5.6*`, the n8n OpenAI Chat Model node with "Use Responses API" on, the `openai` SDK's `client.responses.create`.

Plugboard is stateless: every request carries the whole conversation in `input`, as Chat Completions does with `messages`. Nothing is stored, so there is no `GET /v1/responses/{id}`.

Tested: `openai` (JS SDK), `ai` 7.0.137 with `@ai-sdk/openai` 4.0.91 (`openai(id)`, 17 of 17 scenarios) and `@langchain/openai` 1.6.2 with `openai/gpt-5.6-luna#low`, 2026-10-11. n8n was not re-run on this path.

```ts
import OpenAI from "openai"

const client = new OpenAI({ baseURL: "http://localhost:4010/v1", apiKey: process.env.PLUGBOARD_KEY })
const r = await client.responses.create({ model: "fast", instructions: "Be terse.", input: "Reply with exactly: pong" })
console.log(r.output_text)
```

## What is supported

| Request field | How it is handled |
| --- | --- |
| `model` | Same as Chat Completions: an alias or `provider/model[#variant]`. |
| `input` | A string, or a list of items: messages (`user`, `assistant`, `system`, `developer`) with `input_text`, `output_text` and `input_image` content; `input_file` with `file_data` or `file_url`; `function_call` and `function_call_output` for tool round trips. `reasoning` items are accepted and dropped. |
| `instructions` | The system prompt, ahead of any `system` or `developer` items. |
| `tools` | `function` tools. `parameters: null` means no arguments. `strict` is accepted and ignored. |
| `tool_choice` | `auto`, `none`, `required`, or `{"type":"function","name":"..."}`. |
| `text.format` | `json_schema` and `json_object`, mapped as in Chat Completions (see [architecture](architecture.md)). `text` is the default. |
| `max_output_tokens`, `temperature`, `top_p` | Passed to the model. |
| `reasoning.effort` | Picks the model variant of that name when the model has one and the id carries none (`openai/gpt-5.6-luna` with `low` becomes `openai/gpt-5.6-luna#low`). Otherwise ignored. `reasoning.summary` is ignored. |
| `stream` | The standard event sequence, below. |
| `store`, `include`, `metadata`, `user`, `parallel_tool_calls`, `service_tier`, `prompt_cache_key`, `safety_identifier`, `max_tool_calls`, `stream_options` | Accepted and ignored. The response always reports `store: false`, because nothing is kept for retrieval. |

## What is rejected

A 400 with `code: "unsupported_parameter"` and `param` naming the field:

- `previous_response_id`, `conversation`: need server-side state. Send the full `input` each time.
- `item_reference` input items: same reason. See the Vercel AI SDK note below.
- `background: true`, `prompt` (stored prompts), `top_logprobs`, `truncation: "auto"`.
- Tools that are not `function` tools (`web_search`, `file_search`, `code_interpreter`, `computer_use`, `mcp`, `image_generation`, `custom`, ...). They run on OpenAI's servers; plugboard only hands function calls back to you.
- `tool_choice` objects other than a function name (`allowed_tools`, hosted tool types), and a named tool together with `text.format` `json_schema`.
- `input_image` or `input_file` with only a `file_id`.

Other invalid input gets a plain 400 `invalid_request_error`, for example a `function_call_output` whose `call_id` no earlier `function_call` item has.

## Output

A response object with `output` items in order: a `message` item (`msg_...`, one `output_text` part) when the model wrote text, and one `function_call` item (`fc_...`, with `call_id`, `name`, `arguments`) per tool call. `status` is `completed`, or `incomplete` with `incomplete_details.reason` `max_output_tokens` or `content_filter`. `usage` has `input_tokens` (including cache reads), `output_tokens` (including reasoning), `total_tokens` and the `*_details` objects. The `x-plugboard-session` header works as on Chat Completions. Reasoning text is not returned.

Errors use the same body as Chat Completions: `{"error": {"message", "type", "param", "code"}}` with the same status codes. In a stream, nothing is sent until there is output, so a failure before the first token is a real HTTP error. A failure after that ends the stream with a `response.failed` event carrying `error.code` and `error.message`.

## Streaming

`stream: true` sends SSE frames `event: <type>` then `data: <json>`, each event with a `sequence_number`, and no `[DONE]` (the Responses API has none):

```text
response.created
response.in_progress
response.output_item.added           (message)
response.content_part.added
response.output_text.delta           (one per model text chunk)
response.output_text.done
response.content_part.done
response.output_item.done
response.output_item.added           (function_call, one per call)
response.function_call_arguments.delta
response.function_call_arguments.done
response.output_item.done
response.completed                   (or response.incomplete / response.failed), with the full response and usage
```

Tool calls arrive whole from the model, so each call is a single `function_call_arguments.delta` holding the full arguments, as in Chat Completions. A structured answer (`json_schema`) is one `output_text.delta`.

## Notes

- Multi-turn with the Vercel AI SDK: its default `store: true` makes it replay earlier assistant text as `item_reference`, which plugboard rejects. Tool loops work (a tool call is replayed as a full `function_call` item). For multi-turn chats set `providerOptions: { openai: { store: false } }`.
- `@langchain/openai` forces this API for ids containing `gpt-5.6`, `gpt-5.2-pro`, `gpt-5.4-pro`, `gpt-5.5-pro` and `codex`. It works now. LangChain's standard base64 image blocks reach plugboard as Chat-style `image_url` parts, so plugboard accepts that part type here too.
- Sampling parameters are forwarded as sent and some providers reject them; see the client pages.
