# Add a /v1/messages (Anthropic) front-end

Tools written for the Anthropic API (the Anthropic SDKs, Claude-style CLIs, some agent frameworks) call `POST /v1/messages`. They can't use plugboard today without an OpenAI shim in between.

## Design notes

A second front-end beside Chat Completions. It parses `system`, `messages` with content blocks (`text`, `image`, `tool_use`, `tool_result`), `tools` with `input_schema`, `tool_choice` and `max_tokens` into a `PlugRequest`, and encodes events as a message object or as Anthropic SSE (`message_start`, `content_block_start`, `content_block_delta`, `message_delta`, `message_stop`).

Auth differs: Anthropic clients send `x-api-key`, not a bearer token. Accept both on this route and keep one key store. Map `thinking.budget_tokens` to a variant if the model has a fitting one, otherwise ignore it and say so in the docs.

Model names stay `provider/model[#variant]`, so a client has to pass something like `anthropic/claude-sonnet-4-6`. Aliases help here.

## Acceptance

- The official Anthropic Python SDK completes a plain chat, a streamed chat and a tool round trip with `base_url` pointed at plugboard.
- `x-api-key` and `Authorization: Bearer` both authenticate.
- Errors use the Anthropic error body shape on this route.
