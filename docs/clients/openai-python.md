# OpenAI Python SDK

Tested: `openai` 3.29.0, 2026-10-11, at an earlier commit. Scenarios S1 to S7 and the error paths passed; `models.retrieve` was a 404 then and is implemented now (see Gotchas).

```python
import os
from openai import OpenAI

client = OpenAI(base_url="http://localhost:4010/v1", api_key=os.environ["PLUGBOARD_KEY"])
```

`fast` below is an alias from the plugboard `aliases` option. Use any allowed `provider/model[#variant]` instead.

## Chat

```python
r = client.chat.completions.create(model="fast", messages=[{"role": "user", "content": "Reply with exactly: pong"}])
print(r.choices[0].message.content)
```

## Tool call

Plugboard returns the call. Your code runs it and sends the result back.

```python
tools = [{"type": "function", "function": {
    "name": "get_weather", "description": "Current weather for a city",
    "parameters": {"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]}}}]
messages = [{"role": "user", "content": "What is the weather in Paris? Use the tool."}]

r = client.chat.completions.create(model="fast", messages=messages, tools=tools)
msg = r.choices[0].message                      # finish_reason == "tool_calls"
call = msg.tool_calls[0]
messages += [msg.model_dump(exclude_none=True),
             {"role": "tool", "tool_call_id": call.id, "content": '{"temp_c": 18, "sky": "cloudy"}'}]
r = client.chat.completions.create(model="fast", messages=messages, tools=tools)
print(r.choices[0].message.content)
```

## Structured output

`client.chat.completions.parse(model=..., messages=..., response_format=Meal)` with a Pydantic model returns `message.parsed`. The `beta` variant works too. Plugboard instructs the model to answer through a `respond` tool, and that worked on every model tested. The provider does not enforce the schema.

## Gotchas

- Tool call ids differ by model (a bare UUID, `chatcmpl-tool-...`, `toolu_...`, `call_...`). Don't parse them.
- Streaming usage needs `stream_options={"include_usage": True}`. A streamed tool call arrives as one delta with the whole arguments string.
- `client.models.list()` and `client.models.retrieve(id)` (`GET /v1/models/{id}`) are both served. `retrieve` was added after the 2026-10-11 run and has not been re-run with this SDK.
- A wrong key raises `AuthenticationError` (401 `invalid_api_key`). An unknown model raises `NotFoundError` (404 `model_not_found`).
