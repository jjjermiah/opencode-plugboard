# Langfuse

Langfuse's drop-in OpenAI wrapper records each call as a trace and sends it to plugboard.

## Connect

Import `OpenAI` from `langfuse.openai` instead of `openai`. The rest is the OpenAI SDK.

<<< @/../examples/langfuse/run.py#snippet

The example sets `PLUGBOARD_BASE_URL` to `http://127.0.0.1:4010/v1`. To send traces, set `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` and `LANGFUSE_BASE_URL`; without them set `LANGFUSE_TRACING_ENABLED=false`.

A tool call. `TOOL` is a function schema and `TOOL_RESULT` the tool's output:

<<< @/../examples/langfuse/run.py#snippet-tools

Streaming, with usage:

<<< @/../examples/langfuse/run.py#snippet-stream

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
