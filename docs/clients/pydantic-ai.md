# pydantic-ai

Tested: `pydantic-ai-slim[openai]` 2.55.0 (Chat Completions API), `openai` 3.29.0, 2026-10-11, at an earlier commit. Every scenario passed, though one `ImageUrl` data URL answer on `fast` failed on its first run and passed on a rerun with an identical request.

```python
import os
from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

provider = OpenAIProvider(base_url="http://localhost:4010/v1", api_key=os.environ["PLUGBOARD_KEY"])
model = OpenAIChatModel("fast", provider=provider)
agent = Agent(model)
```

`fast` is an alias from the plugboard `aliases` option. Use any allowed `provider/model[#variant]` instead.

## Chat

```python
print(agent.run_sync("Reply with exactly: pong").output)
```

## Tool call

```python
@agent.tool_plain
def get_weather(city: str) -> str:
    """Current weather for a city."""
    return '{"temp_c": 18, "sky": "cloudy"}'

print(agent.run_sync("What is the weather in Paris? Use the tool.").output)
```

pydantic-ai runs the tool and makes the second request itself.

## Structured output

`Agent(model, output_type=Meal)` (tool mode), `NativeOutput(Meal)` and `PromptedOutput(Meal)` all worked on three models. `PromptedOutput` sends `json_object` with the schema in the prompt, and `fast` returned numbers as strings once. Lax validation hid that. Prefer the default tool mode or `NativeOutput`.

## Gotchas

- Use `OpenAIChatModel`, the path this page was run on. `OpenAIResponsesModel` calls `/v1/responses`, which plugboard serves (see [Responses API](../responses.md)); it has not been run with pydantic-ai here.
- pydantic-ai always sends `stream_options.include_usage`, so streaming usage needs no setup.
- It has no list-models call. Use the provider's OpenAI client, `provider.client.models.list()`, with `provider` the `OpenAIProvider` you built.
- `openai_reasoning_effort` and `max_tokens` in model settings are accepted.
