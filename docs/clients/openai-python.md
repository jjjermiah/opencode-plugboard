# OpenAI Python SDK

The official `openai` package. It works with plugboard on both Chat Completions and the Responses API.

## Connect

```python
import os
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:4010/v1", api_key=os.environ["PLUGBOARD_KEY"])
```

`model` is an alias from your `aliases` option, such as `"fast"`, or any allowed `provider/model[#variant]`.

## Chat

<<< @/../examples/openai-python/chat.py#snippet

## Tool calls

Plugboard returns the call. Your code runs the tool and sends the result back. `TOOL` is a function schema and `TOOL_RESULT` the tool's output.

<<< @/../examples/openai-python/tools.py#snippet

## Structured output

`client.chat.completions.parse(model=..., messages=..., response_format=Meal)` with a Pydantic model returns `message.parsed`. The full example is [`structured.py`](https://github.com/jjjermiah/opencode-plugboard/blob/main/examples/openai-python/structured.py).

## Responses API

Text:

<<< @/../examples/openai-python/chat.py#snippet-responses

Tool calls. `RESPONSES_TOOL` is the tool in the Responses shape (name at the top level, no `function` wrapper). With `store=False` you send the whole history in `input`; with the default `store=True` you can pass `previous_response_id` instead.

<<< @/../examples/openai-python/tools.py#snippet-responses

Streaming, reading `response.output_text.delta` events:

<<< @/../examples/openai-python/stream.py#snippet-responses

Images, as a data URL:

<<< @/../examples/openai-python/image.py#snippet-responses

Structured output with `responses.parse`, or the raw `text.format` `json_schema` form:

<<< @/../examples/openai-python/structured.py#snippet-responses

`client.responses.retrieve`, `input_items.list` and `delete` work on stored responses. See [Responses API](../responses.md).

## Files

`client.files.create(file=open("doc.pdf", "rb"), purpose="user_data")` returns an id you can use in a `file` part (Chat) or an `input_file` part (Responses). See [Files](../files.md).

## Limits

- Tool call ids differ by model (`call_...`, `toolu_...`, a bare UUID). Don't parse them.
- Streaming usage needs `stream_options={"include_usage": True}`. A streamed tool call arrives as one delta with the whole arguments string.
- The schema in structured output is not enforced by the provider. Validate the answer.
- A wrong key raises `AuthenticationError` (401). An unknown model raises `NotFoundError` (404).
