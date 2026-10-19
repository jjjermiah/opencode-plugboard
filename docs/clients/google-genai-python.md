# Google GenAI Python SDK

The official `google-genai` package, on plugboard's [Gemini API](../gemini.md).

## Connect

The SDK adds `/v1beta` itself, so the base URL is the plugboard origin:

```python
from google import genai
from google.genai import types

client = genai.Client(api_key=PLUGBOARD_KEY, http_options=types.HttpOptions(base_url="http://127.0.0.1:4010"))
```

## Chat

<<< @/../examples/gemini-python/chat.py#snippet

## Tool calls

Gemini calls carry no id: the function name pairs a `functionResponse` with its call.

<<< @/../examples/gemini-python/tools.py#snippet

## Streaming

<<< @/../examples/gemini-python/stream.py#snippet

A streamed tool call arrives whole, in one chunk:

<<< @/../examples/gemini-python/stream_tools.py#snippet

## Images

<<< @/../examples/gemini-python/image.py#snippet

## Structured output

<<< @/../examples/gemini-python/structured.py#snippet

## Files

`client.files.upload(file="doc.pdf")` uploads through plugboard; pass the returned file to `generate_content` like any other part. See [Files](../files.md).

## Model names

A `#` in a model name must be sent as `%23` (`openai/gpt-5.6-luna%23low`); a `/` goes as it is. Aliases avoid both. See [Gemini model names](../gemini.md#model-names).

## Limits

- Errors raise `ClientError` with the HTTP status; the body's `status` is Google's name (`UNAUTHENTICATED`, `NOT_FOUND`).
- The schema in structured output is not enforced by the provider. Validate the answer.
