# Langfuse

Langfuse's drop-in OpenAI wrapper records each call as a trace and sends it to plugboard.

## Connect

```python
from langfuse.openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:4010/v1", api_key=os.environ["PLUGBOARD_KEY"])
```

The only change from the OpenAI SDK is the import. To send traces, set `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` and `LANGFUSE_BASE_URL`; without them set `LANGFUSE_TRACING_ENABLED=false`.

A script with a text reply, a stream and a tool round trip is in [examples/langfuse/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/langfuse):

```sh
cd examples/langfuse
PLUGBOARD_KEY=<app key> uv run example.py
```

## What works

Everything the OpenAI SDK does through plugboard, with the wrapper's `name` argument labelling each generation.

## Limits

- The SDK sends traces in the background; call `get_client().flush()` before a short script exits.
- Beta OpenAI APIs are not traced by the wrapper.
