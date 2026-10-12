# LiteLLM (as a client)

Tested: `litellm` 1.105.0 (with `openai` 2.54.0, from `compat/py-litellm`), 2026-10-12, against the scripted fake plugboard. Completion, streaming, a tool round trip and structured output passed. The live dev server was not reachable on that date, so no live result yet; see [compatibility](../compatibility.md#python-clients).

LiteLLM is usually run as a gateway. Used as a client, `litellm.completion` normalises the request and sends it to any OpenAI-compatible `api_base`. This page is about that use; for LiteLLM in front of plugboard, the gateway case is different.

```python
import litellm

r = litellm.completion(
    model="openai/fast",                       # the openai/ prefix selects Chat Completions
    api_base="http://localhost:4010/v1",
    api_key=os.environ["PLUGBOARD_KEY"],
    messages=[{"role": "user", "content": "Reply with exactly: pong"}],
)
print(r.choices[0].message.content)
```

`fast` is an alias from the plugboard `aliases` option. Other ids were not run through LiteLLM; the `openai/` prefix should carry a `provider/model[#variant]` id through unchanged, but that is untested.

## Streaming

```python
for chunk in litellm.completion(model="openai/fast", api_base=..., api_key=..., messages=..., stream=True):
    print(chunk.choices[0].delta.content or "", end="")
```

## Tool call

Plugboard returns the call and LiteLLM hands it back as `tool_calls`. Your code runs the tool and sends the result in a `tool` message, as with the OpenAI SDK (see [OpenAI Python](openai-python.md#tool-call)).

## Structured output

```python
from pydantic import BaseModel

class Answer(BaseModel):
    answer: str

r = litellm.completion(model="openai/fast", api_base=..., api_key=..., messages=..., response_format=Answer)
parsed = Answer.model_validate_json(r.choices[0].message.content)
```

Plugboard maps `json_schema` to a forced tool and returns its arguments as the content, so the JSON parses without a retry.

## Gotchas

- Use `api_base` with `/v1` and no path after it. LiteLLM adds `/chat/completions` itself.
- Every test call used the `openai/` prefix. Calls without it were not tried.
- LiteLLM reads its price map from GitHub on import. Set `LITELLM_LOCAL_MODEL_COST_MAP=True` to skip that fetch, as the harness does.
- `litellm.telemetry` is off in the harness; leave it off in scripts that run offline.

Harness: `compat/py/clients/litellm_client.py`. Example: [`examples/litellm-client/`](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/litellm-client).
