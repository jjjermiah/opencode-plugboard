# Instructor

Instructor wraps the OpenAI client and returns a validated Pydantic object.

## Connect

<<< @/../examples/instructor/structured.py#snippet-client

## Modes

`Mode.TOOLS` (a tool built from your model, forced with `tool_choice`):

<<< @/../examples/instructor/structured.py#snippet-tools

`Mode.JSON_SCHEMA` (a `json_schema` response format):

<<< @/../examples/instructor/structured.py#snippet-json-schema

Partial streaming with `create_partial`, which yields growing objects:

<<< @/../examples/instructor/structured.py#snippet-partial

## Limits

- The schema is not enforced by the provider. Keep `max_retries` above 0 so Instructor retries an answer that fails validation.
- With both a `tools` list and a `response_model`, the model may call one of your tools instead of giving the structured answer.
