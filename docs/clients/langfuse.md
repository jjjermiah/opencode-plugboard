# Langfuse

Langfuse's drop-in OpenAI wrapper sends each call to plugboard and records it as a generation in Langfuse.

## Connect

Import `OpenAI` from `langfuse.openai` instead of `openai`. The rest is the OpenAI SDK.

<<< @/../examples/langfuse/run.py#snippet

The example sets `PLUGBOARD_BASE_URL` to `http://127.0.0.1:4010/v1`.

## Tracing

The SDK sends traces to the Langfuse server named by `LANGFUSE_BASE_URL`, with `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`. Set all three before the first call. Without them the wrapper has nothing to send to, and `LANGFUSE_TRACING_ENABLED=false` turns tracing off.

<<< @/../examples/langfuse/run.py#snippet-tracing

The SDK exports each generation as OTLP spans to `<LANGFUSE_BASE_URL>/api/public/otel/v1/traces`. A generation carries the model name you sent (`fast`), the prompt, the answer and the token usage plugboard returned. The SDK exports in the background, so flush before a short script exits:

<<< @/../examples/langfuse/run.py#snippet-flush

A tool call. `TOOL` is a function schema and `TOOL_RESULT` the tool's output:

<<< @/../examples/langfuse/run.py#snippet-tools

Streaming, with usage:

<<< @/../examples/langfuse/run.py#snippet-stream

A script with a text reply, a stream and a tool round trip is in [examples/langfuse/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/langfuse):

```sh
cd examples/langfuse
PLUGBOARD_KEY=<app key> uv run example.py
```

The script traces only when the three Langfuse variables are set.

## What works

Everything the OpenAI SDK does through plugboard, with the wrapper's `name` argument labelling each generation. Streamed calls are traced with their usage when the request asks for it (`stream_options={"include_usage": True}`).

## Limits

- Beta OpenAI APIs are not traced by the wrapper.
