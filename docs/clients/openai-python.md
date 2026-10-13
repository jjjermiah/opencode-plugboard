# OpenAI Python SDK

Tested: `openai` 3.29.0, live run [`2026-10-12-a38860b`](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/openai-python/runs/live/2026-10-12-a38860b) at plugboard 0.24.0 (`a38860b`): pass. Scenarios S1 to S7 and the error paths passed; `models.retrieve` is in the Gotchas. The code below is the example's snippet, and the run's summary and transcripts are in the example directory.

```python
import os
from openai import OpenAI

client = OpenAI(base_url="http://localhost:4010/v1", api_key=os.environ["PLUGBOARD_KEY"])
```

`fast` below is an alias from the plugboard `aliases` option. Use any allowed `provider/model[#variant]` instead.

## Chat

The snippet uses `client` (above) and `model` (`"fast"`).

<<< @/../examples/openai-python/chat.py#snippet

## Tool call

Plugboard returns the call. Your code runs it and sends the result back.

The snippet uses `client`, `model`, `messages` (a list holding the user prompt), `TOOL` (the `get_weather` schema, `examples/_shared/get_weather.tool.json`) and `TOOL_RESULT` (`examples/_shared/get_weather.result.json`).

<<< @/../examples/openai-python/tools.py#snippet

## Structured output

`client.chat.completions.parse(model=..., messages=..., response_format=Meal)` with a Pydantic model returns `message.parsed`. The `beta` variant works too. Plugboard instructs the model to answer through a `respond` tool, and that worked on every model tested. The provider does not enforce the schema. The example is [`structured.py`](https://github.com/jjjermiah/opencode-plugboard/blob/main/examples/openai-python/structured.py).

## Gotchas

- Tool call ids differ by model (a bare UUID, `chatcmpl-tool-...`, `toolu_...`, `call_...`). Don't parse them.
- Streaming usage needs `stream_options={"include_usage": True}`. A streamed tool call arrives as one delta with the whole arguments string.
- `client.models.list()` and `client.models.retrieve(id)` (`GET /v1/models/{id}`) are both served. `retrieve` was added after the 2026-10-11 run and has not been re-run with this SDK.
- A wrong key raises `AuthenticationError` (401 `invalid_api_key`). An unknown model raises `NotFoundError` (404 `model_not_found`).
