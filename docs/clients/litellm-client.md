# LiteLLM (as a client)

`litellm.completion` used as a client library, sending to plugboard's Chat Completions.

## Connect

Prefix the model with `openai/` and set `api_base` to the `/v1` base (LiteLLM adds `/chat/completions`):

<<< @/../examples/litellm-client/chat.py#snippet-client

## Completion

<<< @/../examples/litellm-client/chat.py#snippet

## Streaming

Ask for usage in the last chunk with `stream_options`:

<<< @/../examples/litellm-client/chat.py#snippet-stream

## Tool calls

LiteLLM hands the call back as `tool_calls`; your code runs the tool and sends a `tool` message.

<<< @/../examples/litellm-client/tools.py#snippet

## Structured output

<<< @/../examples/litellm-client/structured.py#snippet

## Limits

- LiteLLM fetches its price map from GitHub on import. Set `LITELLM_LOCAL_MODEL_COST_MAP=True` to skip it.
