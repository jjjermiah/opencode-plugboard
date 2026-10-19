# pydantic-ai (Anthropic)

pydantic-ai with `AnthropicModel`, on plugboard's [Messages API](../messages.md). For the OpenAI-shaped model, see [pydantic-ai](pydantic-ai.md).

## Connect

`AnthropicModel` takes an Anthropic SDK client whose base URL is the plugboard origin, without `/v1`:

<<< @/../examples/pydantic-ai-anthropic/llm.py#snippet

## Chat

<<< @/../examples/pydantic-ai-anthropic/chat.py#snippet

## Tool calls

<<< @/../examples/pydantic-ai-anthropic/tools.py#snippet

## Structured output

<<< @/../examples/pydantic-ai-anthropic/structured.py#snippet

## Limits

- Errors carry `error.type` and no `error.code`.
