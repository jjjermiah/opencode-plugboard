# LiteLLM (as a client)

<ExampleResult example="litellm-client" />

Tested: `litellm` 1.105.0 (with `openai` 2.54.0). Live record [2026-10-12 at `a67e176`](https://github.com/jjjermiah/opencode-plugboard/blob/main/examples/litellm-client/runs/live/2026-10-12-a67e176/REPORT.md): all 4 scenarios passed on the isolated live dev server (`fast` = `opencode-go/glm-5.3-flash`). The example's scripted run is checked in CI: completion, stream, tool round trip and structured output pass on the three models.

LiteLLM is usually run as a gateway. Used as a client, `litellm.completion` normalises the request and sends it to any OpenAI-compatible `api_base`. This page is about that use; for LiteLLM in front of plugboard, the gateway case is different.

The example's helper adds the `openai/` prefix, which selects Chat Completions, and reads the base URL and key from the environment:

<<< @/../examples/litellm-client/chat.py#snippet-client

## Completion

<<< @/../examples/litellm-client/chat.py#snippet

`fast` is an alias from the plugboard `aliases` option. The example also runs `anthropic/claude-haiku-4-5` and `openai/gpt-5.6-luna#low` through the same path.

## Streaming

The stream asks for usage in the last chunk, so the run can check it:

<<< @/../examples/litellm-client/chat.py#snippet-stream

## Tool call

Plugboard returns the call and LiteLLM hands it back as `tool_calls`. Your code runs the tool and sends the result in a `tool` message, as with the OpenAI SDK (see [OpenAI Python](openai-python.md#tool-call)).

<<< @/../examples/litellm-client/tools.py#snippet

## Structured output

Plugboard maps `json_schema` to a forced tool and returns its arguments as the content, so the JSON parses without a retry.

<<< @/../examples/litellm-client/structured.py#snippet

## Gotchas

- Use `api_base` with `/v1` and no path after it. LiteLLM adds `/chat/completions` itself.
- Every test call used the `openai/` prefix. Calls without it were not tried.
- LiteLLM reads its price map from GitHub on import. Set `LITELLM_LOCAL_MODEL_COST_MAP=True` to skip that fetch, as the example does.
- `litellm.telemetry` is off in the example; leave it off in scripts that run offline.

Example: [`examples/litellm-client/`](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/litellm-client).
