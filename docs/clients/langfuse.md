# Langfuse

Verified: run, 2026-10-13. `examples/langfuse` (langfuse 4.17.0, openai 3.29.0, Python 3.12, run with `uv run`) ran against plugboard with model `fast`: a text call, a stream and one tool round trip all passed. Langfuse tracing was off, because no Langfuse server or keys were available here, so the traces were not checked in a Langfuse instance. The config was checked against the Langfuse OpenAI (Python) integration page, <https://langfuse.com/integrations/model-providers/openai-py>. Not in `docs/compatibility.md` yet: there is no scripted test for it.

Langfuse is an LLM observability platform. It is not an OpenAI library. Its Python SDK ships a drop-in OpenAI wrapper that records each call as a trace while it sends the request to whatever `base_url` you give it. Here the wrapper sends to plugboard, and plugboard is the only model endpoint.

## Plugboard config

```python
from langfuse.openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:4010/v1",
    api_key="<app key>",
)
```

- The only change from the plain OpenAI SDK is the import: `from langfuse.openai import OpenAI`. Calls after that are the usual `client.chat.completions.create(...)`.
- `base_url` replaces the default `https://api.openai.com/v1` whole, so include `/v1`.
- `api_key` is a plugboard app key, not an OpenAI key.
- `fast` is an alias from the plugboard `aliases` option. Use it as `model`.

To send traces to Langfuse, also set `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` and `LANGFUSE_BASE_URL` (the Langfuse Cloud or self-hosted URL). The plugboard config does not change.

A copyable script is in [examples/langfuse/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/langfuse).

## What the example does

`example.py` makes three calls against `POST /v1/chat/completions`:

1. A text reply.
2. A streamed reply, read until the chunks end.
3. One tool round trip: the model asks for `get_weather`, the script returns the result as a `tool` message, and the model answers.

Run it:

```sh
cd examples/langfuse
PLUGBOARD_KEY=<app key> uv run example.py
```

With no `LANGFUSE_PUBLIC_KEY` set, the script sets `LANGFUSE_TRACING_ENABLED=false`, so no Langfuse server is needed. To trace, set the three `LANGFUSE_*` variables above and run the same command; that path was not run.

## Features exercised

- Chat Completions through the wrapped client, with `max_completion_tokens=1024`.
- Streaming with `stream=True`.
- A function tool with a JSON Schema `parameters` value, and the tool result sent back with `tool_call_id`.
- The wrapper's `name` argument, which labels each generation in Langfuse. It is accepted with tracing off.

Not exercised: a live trace in a Langfuse instance, usage and cost capture, the Responses API, structured output (`parse`), async clients and error tracking.

## Quirks

- With no Langfuse keys, the SDK prints an `Authentication error: Langfuse client initialized without public_key` warning on startup, even with tracing disabled. The calls still succeed. Set the keys, or ignore the warning for a local run.
- Tracing is controlled by `LANGFUSE_TRACING_ENABLED`, or `Langfuse(tracing_enabled=False)`, per the integration page.
- The SDK queues events and sends them in the background. Short scripts should call `get_client().flush()` before exit. The example does not, because tracing is off.
- The OpenAI wrapper traces only the stable OpenAI SDK surface, so beta APIs are not traced.
