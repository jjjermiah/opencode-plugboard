# Chat Completions

`POST /v1/chat/completions` is the OpenAI Chat Completions API, and the one most apps speak. Point any OpenAI SDK at `http://127.0.0.1:4010/v1` with your plugboard key.

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:4010/v1", api_key=PLUGBOARD_KEY)
reply = client.chat.completions.create(model="fast", messages=[{"role": "user", "content": "reply with exactly: pong"}])
```

The same with curl and `jq`. `PLUGBOARD_BASE_URL` is `http://127.0.0.1:4010/v1` and `PLUGBOARD_KEY` is your key. `post` sends a JSON body:

<<< @/../examples/curl/chat.sh#snippet

<<< @/../examples/curl/chat.sh#snippet-s1

Plugboard is stateless here: every request carries the whole conversation in `messages`.

## Request fields

| Field | What plugboard does |
| --- | --- |
| `model` | An alias, or `provider/model[#variant]` that `models` allows. |
| `messages` | `system`, `developer`, `user`, `assistant` and `tool` messages. User content can hold text and images. A `file` part takes `file_data` (a PDF data URL) or a `file_id` from the [Files API](files.md). An unknown `file_id` is a 404. |
| `stream`, `stream_options.include_usage` | Server-sent events. With `include_usage`, the last chunk carries the usage. |
| `tools`, `tool_choice`, `parallel_tool_calls` | Tool calls come back to you; plugboard never runs them. `parallel_tool_calls: false` keeps the first call and sets `x-plugboard-parallel-tools: limited`. |
| `response_format` | `json_schema` or `json_object`. See [structured output](#structured-output). |
| `n` | Several answers, one full model call each, up to `maxN`. See [completions](completions.md#n-above-1). |
| `temperature`, `top_p`, `presence_penalty`, `frequency_penalty` | Passed to the model. Values a model is known to reject are dropped and listed in `x-plugboard-dropped-params`. |
| `seed` | An integer, passed to the model. A model whose protocol sends no seed (Claude, GPT-5 and 6) drops it and lists `seed` in `x-plugboard-dropped-params`. There is no top-k field here. |
| `max_completion_tokens`, `max_tokens` | The output cap. `max_completion_tokens` wins when both are sent. |
| `stop` | Up to 4 sequences. The answer ends before the first match. |
| `reasoning_effort` | Picks the model's variant of that name, else the nearest one above it, else its highest. A model with no variants answers without thinking and sets `x-plugboard-thinking: unavailable`. |
| `user` | The end user, for usage per user and the history title. |

## Refused

Errors are 400s with the code below and `param` naming the field.

| Request | Code |
| --- | --- |
| `logprobs: true`, or any `top_logprobs` | `unsupported_parameter` |
| `n` above `maxN` | `too_many_choices` |
| A `tool_choice` that names a tool, with `response_format` `json_schema` | `unsupported_parameter` |
| A tool named `respond`, with `response_format` `json_schema` | `reserved_tool_name` |

## Streaming

<<< @/../examples/curl/chat.sh#snippet-s3

The status and headers go out with the first model event. A slow model gets a keep-alive comment every 15 seconds. If the run fails after the stream has started, the client gets an `error` event and then `data: [DONE]`.

## Tools

The model's tool calls come back with `finish_reason: "tool_calls"`. Run the tool yourself and send the result back as a `tool` message with the same call id. The whole round trip with curl:

<<< @/../examples/curl/chat.sh#snippet-s2

Tool call ids differ by model, so do not parse them. `maxTools` (default 64) caps the tools one request may carry. An app with `serverTools` can also let OpenCode run some of its own tools; see [Tools, structured output and images](guides/tools-output-and-images.md).

## Structured output

`response_format: {"type": "json_schema", ...}` returns the JSON as the message content. The model answers through a `respond` tool, and the provider does not enforce the schema, so validate the result. `json_object` carries no schema: name the keys in the prompt.

With caller `tools` as well, the model may either call one of your tools or give the schema answer.

## Errors

Errors use OpenAI's shape, `{"error": {"message", "type", "code", "param"}}`. See [Limits and errors](configuration.md#limits-and-errors) for the codes and [Response headers](headers.md) for the `x-plugboard-*` headers.
