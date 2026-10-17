# pydantic-ai (Anthropic)

<ExampleResult example="pydantic-ai-anthropic" />

Tested: `pydantic-ai-slim` 2.55.0 with `anthropic` 1.15.0 on Python 3.13. The example runs S1 to S7 and the two error paths through pydantic-ai's `AnthropicModel`, on plugboard's Messages route. The scripted run passes, S7 included since 0.47.0 ([#399](https://github.com/jjjermiah/opencode-plugboard/issues/399)). The last live run, on plugboard main v0.41.0 (`v0.41.0-13-g7e1fdcb`), predates that fix and is `partial`: the only gap is S7 ([record](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/pydantic-ai-anthropic/runs/live/2026-10-16-v0.41.0-13-g7e1fdcb)). The `fast` alias falls back to `anthropic/claude-haiku-4-5` when its Go provider is rate-limited, so `fast` rows can be Haiku answers. For the Chat Completions version, see [pydantic-ai](pydantic-ai.md).

`AnthropicModel` takes an Anthropic SDK client. Its base URL is plugboard's base URL without the `/v1`, because the SDK adds `/v1/messages` itself:

<<< @/../examples/pydantic-ai-anthropic/llm.py#snippet

## Chat

<<< @/../examples/pydantic-ai-anthropic/chat.py#snippet

## Tool call

<<< @/../examples/pydantic-ai-anthropic/tools.py#snippet

## Structured output

`output_type` makes pydantic-ai ask for the fields through its own output tool, not `output_config.format`, so plugboard accepts it on every model.

<<< @/../examples/pydantic-ai-anthropic/structured.py#snippet

## Gotchas

- Listing models with the Anthropic client's `x-api-key` needs plugboard 0.47.0 or later ([#399](https://github.com/jjjermiah/opencode-plugboard/issues/399)).
- Messages errors carry `error.type` and no `error.code`. The example checks the status and the type, not a code.
