# LangChain Python

Tested: `langchain-openai` 1.7.0, `langchain-core` 1.6.9, live run 2026-10-13 against plugboard `c97ac66` (0.26.0). Every scenario passed on `fast`, `anthropic/claude-haiku-4-5` and `openai/gpt-5.6-luna#low`. The run and its report are in [`examples/langchain-python/runs/live/2026-10-13-c97ac66`](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/langchain-python/runs/live/2026-10-13-c97ac66). `json_mode` on `fast` returned valid JSON on that run (one sample; see Structured output).

```python
import os
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    base_url="http://localhost:4010/v1",
    api_key=os.environ["PLUGBOARD_KEY"],
    model="fast",
    use_responses_api=False,   # always set this
    stream_usage=True,         # usage while streaming
)
```

`fast` is an alias from the plugboard `aliases` option. Use any allowed `provider/model[#variant]` instead.

## Chat

```python
print(llm.invoke("Reply with exactly: pong").content)
```

## Tool call

```python
from langchain_core.messages import ToolMessage
from langchain_core.tools import tool

@tool
def get_weather(city: str) -> str:
    """Current weather for a city."""
    return '{"temp_c": 18, "sky": "cloudy"}'

bound = llm.bind_tools([get_weather])
history = ["What is the weather in Paris? Use the tool."]
ai = bound.invoke(history)                       # ai.tool_calls[0]["name"] == "get_weather"
history += [ai, ToolMessage(content=get_weather.invoke(ai.tool_calls[0]["args"]), tool_call_id=ai.tool_calls[0]["id"])]
print(bound.invoke(history).content)
```

## Structured output

`llm.with_structured_output(Meal, method="json_schema")` and `method="function_calling"` both work. `method="json_mode"` sends `json_object` with no schema, and a weak model can return `{}` or numbers as strings.

## Gotchas

- Set `use_responses_api=False`. Left unset, an id that starts with `gpt-5.6` can switch the client to the Responses API. Plugboard serves that API (see [Responses API](../responses.md)), but this page's runs used Chat Completions. A `provider/` prefix avoids it, but set the flag anyway.
- LangChain has no list-models call. Use the wrapped OpenAI client (`llm.root_client.models.list()`).
- A wrong key raises `openai.AuthenticationError` (401, `invalid_api_key`). An unknown model raises `openai.NotFoundError` (404, `model_not_found`).
