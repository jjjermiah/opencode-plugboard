# Add a /v1/responses front-end

Newer OpenAI SDK versions and tools built on them (Codex-style clients, recent agent frameworks) call `POST /v1/responses` instead of Chat Completions. Plugboard v0.1 only serves Chat Completions, so those clients get a 404.

## Design notes

This should be a new front-end on the existing core, not a change to it. The front-end parses `input` items (messages, function calls, function call outputs, input images) and `instructions` into a `PlugRequest`, and encodes `PlugEvent`s as a response object or as the named SSE events the Responses API uses (`response.created`, `response.output_text.delta`, `response.function_call_arguments.delta`, `response.completed`). Model resolution, keys, the allowlist and the session backend stay as they are.

Decide early how `previous_response_id` and `store` behave. A first version can reject `previous_response_id` with a clear 400 and require the full input each time, which matches how history already works.

## Acceptance

- Plain text, streaming text, one tool round trip and one image input work through the OpenAI SDK's `client.responses.create`.
- `instructions` and `reasoning.effort` map to the system prompt and a variant.
- Unsupported fields return 400 `unsupported_parameter` naming the field.
- No change to the core or to the Chat Completions front-end.
