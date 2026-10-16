# Google GenAI Python SDK

<ExampleResult example="gemini-python" />

Tested: `google-genai` 2.31.0, live run [`2026-10-16-v0.41.0-29-g2d6aac1`](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/gemini-python/runs/live/2026-10-16-v0.41.0-29-g2d6aac1) at plugboard 0.41.0: pass. The SDK's `inlineData` (`mime_type`, URL-safe base64) works since [#401](https://github.com/jjjermiah/opencode-plugboard/issues/401) and [#409](https://github.com/jjjermiah/opencode-plugboard/issues/409) were fixed. The code below is the example's snippets.

## Setup

The SDK adds `/v1beta` itself, so the base URL is the plugboard origin, without `/v1`:

```python
from google import genai
from google.genai import types

client = genai.Client(api_key=PLUGBOARD_KEY, http_options=types.HttpOptions(base_url="http://127.0.0.1:4010"))
```

The snippets use `client` (above) and `model`, `"fast"` in the examples.

## Chat

<<< @/../examples/gemini-python/chat.py#snippet

## Tool call

<<< @/../examples/gemini-python/tools.py#snippet

## Streaming

<<< @/../examples/gemini-python/stream.py#snippet

<<< @/../examples/gemini-python/stream_tools.py#snippet

## Image

Inline bytes go through `Part.from_bytes`.

<<< @/../examples/gemini-python/image.py#snippet

## Structured output

<<< @/../examples/gemini-python/structured.py#snippet

## Model ids

A bare `#` starts a URL fragment, so `openai/gpt-5.6-luna#low` is sent as `openai/gpt-5.6-luna%23low`. `run.py` does this for every scenario. A `/` goes as it is. See [Gemini API](../gemini.md#model-names).

## Errors

<<< @/../examples/gemini-python/errors.py#snippet-wrong-key

<<< @/../examples/gemini-python/errors.py#snippet-unknown-model

Errors raise `ClientError` with the HTTP code. The body's `status` (`UNAUTHENTICATED`, `NOT_FOUND`) is the name Google uses, not the OpenAI codes.

## Gotchas

- `client.models.list()` and `client.models.get()` are served.
- Gemini calls carry no id. The name pairs a function response with its call.
