# Responses API

`POST /v1/responses` is served next to Chat Completions, with the same keys, model ids, aliases and limits. Use it when a client only speaks Responses: the Vercel AI SDK's `openai(id)`, `@langchain/openai` for ids such as `gpt-5.6*`, the n8n OpenAI Chat Model node with "Use Responses API" on, the `openai` SDK's `client.responses.create`.

A request can carry the whole conversation in `input`, as Chat Completions does with `messages`, or continue an earlier answer with `previous_response_id`. Plugboard keeps each answer made with `store` on, which is the default, so `GET /v1/responses/{id}`, `DELETE /v1/responses/{id}` and `GET /v1/responses/{id}/input_items` work too. See [Stored responses](#stored-responses).

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
| `input` | A string, or a list of items: messages (`user`, `assistant`, `system`, `developer`) with `input_text`, `output_text` and `input_image` content; `input_file` with `file_data`, `file_url` or a `file_id` (see [Files API](files.md)); `input_image` with a `file_id`; `function_call` and `function_call_output` for tool round trips. `reasoning` input items are accepted and dropped. |
| `instructions` | The system prompt, ahead of any `system` or `developer` items. |
| `tools` | `function` tools. `parameters: null` means no arguments. `strict` is accepted and ignored. |
| `tool_choice` | `auto`, `none`, `required`, or `{"type":"function","name":"..."}`. |
| `text.format` | `json_schema` and `json_object`, mapped as in Chat Completions (see [architecture](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/architecture.md)). `text` is the default. |
| `max_output_tokens`, `temperature`, `top_p` | Passed to the model. |
| `reasoning.effort` | Picks the model variant of that name when the model has one and the id carries none (`openai/gpt-5.6-luna` with `low` becomes `openai/gpt-5.6-luna#low`). Otherwise ignored. `reasoning.summary` is ignored. |
| `stream` | The standard event sequence, below. |
| `parallel_tool_calls: false` | Keeps only the first tool call of the answer, and the response carries `x-plugboard-parallel-tools: limited`. The response echoes the value it received (`true` unless the request sent `false`). |
| `include`, `metadata`, `user`, `service_tier`, `prompt_cache_key`, `safety_identifier`, `max_tool_calls`, `stream_options` | Accepted and ignored. |
| `store` | On by default, as on OpenAI: the answer is kept for `previous_response_id` and the stored-response routes. `store: false` keeps nothing: the answer is not retrievable, cannot be chained from, and a later `item_reference` to its items is a 400 `item_not_found`. The response echoes the value you sent (`true` when you leave it out). |
| `previous_response_id` | The id of a stored response of the same app. Its input and output come first, then your `input`. `instructions` do not carry over. An unknown id is a 400 `previous_response_not_found`. See [Stored responses](#stored-responses). |

## What is refused

A 400 with `code: "unsupported_parameter"` and `param` naming the field:

| Request | Why |
| --- | --- |
| `conversation` | Use `previous_response_id`, or send the full `input` each time. |
| `item_reference` input items that name no output item plugboard holds | See [Multi-turn with the Vercel AI SDK](#multi-turn-with-the-vercel-ai-sdk). A reference to an output item of a recent answer works. |
| `background: true`, `prompt` (stored prompts), `top_logprobs`, `truncation: "auto"` | Not available. |
| Tools that are not `function` tools (`web_search`, `file_search`, `code_interpreter`, `computer_use`, `mcp`, `image_generation`, `custom`, ...) | They run on OpenAI's servers. Plugboard only hands function calls back to you. |
| `tool_choice` objects other than a function name (`allowed_tools`, hosted tool types), and a named tool together with `text.format` `json_schema` | Not available. |

Other refusals:

| Request | Answer |
| --- | --- |
| `input_image` or `input_file` with a `file_id` the app does not hold | 404 (see [Files API](files.md)). |
| A tool named `respond` together with `text.format` `json_schema` | 400 `reserved_tool_name`. |
| More tools than `maxTools` | 400 `too_many_tools`. |
| Any other invalid input, for example a `function_call_output` whose `call_id` no earlier `function_call` item has | 400 `invalid_request_error`. |

## Output

A response object with `output` items in order: a `message` item (`msg_...`, one `output_text` part) when the model wrote text, and one `function_call` item (`fc_...`, with `call_id`, `name`, `arguments`) per tool call. `status` is `completed`, or `incomplete` with `incomplete_details.reason` `max_output_tokens` or `content_filter`. The message item that the cut left open is `incomplete` too. `usage` has `input_tokens` (including cache reads), `output_tokens` (including reasoning), `total_tokens` and the `*_details` objects. The `x-plugboard-session` header works as on Chat Completions.

Reasoning text comes back only when the server sets `reasoningOutput` (per app or global). A `reasoning` item then comes before the message, with one `summary_text` part holding the provider's reasoning text itself, not a generated summary. The item appears whether or not the request set `reasoning.summary`. See [Reasoning output](configuration.md#reasoning-output).

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

Tool calls arrive whole from the model, so each call is a single `function_call_arguments.delta` holding the full arguments, as in Chat Completions.

A structured answer (`json_schema`) is one `output_text.delta`. Its text is held back until the turn ends, so the stream commits with the first output event (the keep-alive comments start then) and a missing answer is a `response.failed` event after that. Without a respond call the answer is taken from the final text when it is the JSON the schema asks for, the same small check as Chat Completions (`x-plugboard-structured-fallback: text`, non-streamed responses only). Any other turn without the call is a 502 `structured_output_missing` for every finish reason, or a `response.failed` once a stream has started.

## Stored responses

With `store` on (the default), plugboard keeps each completed or incomplete answer, per app: every input item the model saw, and the response object. A failed answer is not kept.

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:4010/v1", api_key="sk-plug-...")
first = client.responses.create(model="fast", input="My name is Ada.")
second = client.responses.create(model="fast", input="What is my name?", previous_response_id=first.id)
client.responses.retrieve(second.id)
client.responses.input_items.list(second.id, order="asc")
client.responses.delete(second.id)
```

- **`previous_response_id`.** The new request's input is the earlier response's input, then its output, then your `input`. Chains of chains work: each stored response holds the whole input it ran on. `instructions` are not carried over (OpenAI's rule): send them again if you want them. `tools`, `text.format` and the other request fields are the request's own too. The response echoes the id in `previous_response_id`. A function call in the earlier output can be answered with a `function_call_output` in your `input`. The model may change between the turns of a chain.
- **`GET /v1/responses/{id}`.** The response object as the caller got it. `stream=true` is a 400 `unsupported_parameter`: a stored response is not replayed. `include` is ignored.
- **`DELETE /v1/responses/{id}`.** `{"id", "object": "response.deleted", "deleted": true}`. It also drops the response's items from the `item_reference` memory. A response chained from it keeps working, because it holds its own copy of the input.
- **`GET /v1/responses/{id}/input_items`.** A list object `{object: "list", data, first_id, last_id, has_more}` of every input item the model saw, history included. `limit` is 1 to 100 (default 20), `order` is `desc` (default, newest first) or `asc`, and `after` is an item id: the page starts after it in the listing order. Every item has an `id`: the one the caller sent, or a generated `msg_`, `fc_` or `fco_` one. A bad `limit`, `order` or `after` is a 400 with the parameter named.
- **One app only.** An app reads, lists, deletes and chains from its own responses. Another app's id is the same miss as an unknown, deleted or expired id, so an id tells another app nothing. Ids are `resp_` plus 32 hex characters (128 bits, 122 of them random), so they cannot be guessed. Errors use OpenAI's body with `invalid_request_error`. `GET`, `DELETE` and `input_items` answer 404: `Response with id '...' not found.` A POST with an unknown `previous_response_id` answers 400, as OpenAI does, with `code: "previous_response_not_found"`, `param: "previous_response_id"` and the message `Previous response with id '...' not found.`
- **Where it lives and for how long.** In the OpenCode plugin storage, the same place usage and runtime keys use, so it survives a restart. It is kept for the app's history retention: `history.maxAgeDays` (or `apps.<name>.history.maxAgeDays`), 30 days when unset. `maxAgeDays: 0` keeps *sessions* forever, but a stored response is a whole conversation, so `0` keeps these 30 days too. There is no separate option: one number says how long an app's history lives. A response past its age is a 404 at once, and a sweep from request handling deletes it. Each app keeps at most 1000 responses and 128 MiB; the oldest go first. An answer whose stored form is over 8 MiB (large images in the input, say) is answered normally but not kept, and plugboard logs `responses.store_skipped`; chaining from it is a 400. If storage fails, the answer is given and `responses.store_failed` is logged.
- **Privacy.** A stored response holds the prompts, images and answers of a conversation, in the host's storage. Use `store: false` for anything that must not be kept, and `DELETE` to remove one. Nothing is logged but counts and operation names: never an id or a body.

## Multi-turn with the Vercel AI SDK

The SDK works with its default `store: true`. It replays each earlier assistant output as an `item_reference`, and plugboard resolves it from an in-memory store of the output items it returned: per app, the last 1000 answers, kept for one hour, in the process only. That memory is separate from stored responses, which are kept in the host storage.

A reference to an item the store does not hold is a 400 `item_not_found`. That happens after a plugboard restart, after the answer expired, for another app's item, and for an answer made with `store: false`. To avoid it, send the earlier items in full, or set `providerOptions: { openai: { store: false } }`, which sends them in full on every turn. Tool loops work either way, because a tool call is replayed as a full `function_call` item.

## LangChain

`@langchain/openai` forces this API for ids containing `gpt-5.6`, `gpt-5.2-pro`, `gpt-5.4-pro`, `gpt-5.5-pro` and `codex`. LangChain's standard base64 image blocks reach plugboard as Chat-style `image_url` parts, so plugboard accepts that part type here too.

Sampling parameters are forwarded as sent and some providers reject them; see the client pages.
