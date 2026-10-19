# Anthropic Python SDK

The official `anthropic` package, on plugboard's [Messages API](../messages.md).

## Connect

Use the base URL without `/v1`. The SDK adds `/v1/messages` itself.

<<< @/../examples/anthropic-python/provider.py#snippet

## Chat

<<< @/../examples/anthropic-python/chat.py#snippet

## Tool calls

The answer has a `tool_use` block. Your code runs the tool and sends a `tool_result` back.

<<< @/../examples/anthropic-python/tools.py#snippet

## Streaming

<<< @/../examples/anthropic-python/stream.py#snippet

## Structured output

Pass `output_config={"format": {"type": "json_schema", "schema": ...}}`; the answer is one text block holding the JSON. See [Structured outputs](../messages.md#structured-outputs). A forced tool also works: a tool whose `input_schema` is the schema, with `tool_choice` set to that tool, and the call's `input` is the answer.

<<< @/../examples/anthropic-python/structured.py#snippet

## Files

`client.beta.files.upload(file=...)` returns an id you can use in an `image` or `document` block with `source: {"type": "file", "file_id": ...}`. See [Files](../files.md).

## Limits

- Errors carry `error.type` (`authentication_error`, `not_found_error`) and no `error.code`.
- The schema in structured output is not enforced by the provider. Validate the answer.
