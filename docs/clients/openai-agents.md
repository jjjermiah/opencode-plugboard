# OpenAI Agents SDK

Tested: `openai-agents` 0.23.1 (with `openai` 3.29.0), 2026-10-12, against the scripted fake plugboard. Text, streaming, a tool round trip and structured output passed on both the Responses API and Chat Completions. The live dev server was not reachable on that date, so no live result yet; see [compatibility](../compatibility.md#python-clients).

The SDK is OpenAI's agent framework. It defaults to the Responses API, so it exercises `/v1/responses`; one call switches it to `/v1/chat/completions`.

```python
import os
from agents import Agent, Runner, set_default_openai_client, set_default_openai_api, set_tracing_disabled
from openai import AsyncOpenAI

client = AsyncOpenAI(base_url="http://localhost:4010/v1", api_key=os.environ["PLUGBOARD_KEY"])
set_default_openai_client(client, use_for_tracing=False)
set_tracing_disabled(True)
# set_default_openai_api("chat_completions")  # omit to keep the Responses API

agent = Agent(name="assistant", model="fast")  # `fast` is an alias from the plugboard `aliases` option
print(Runner.run_sync(agent, "Reply with exactly: pong").final_output)
```

The harness passes an explicit client. Setting `OPENAI_BASE_URL` alone was not tested.

## Tool call

```python
from agents import function_tool

@function_tool
def get_weather(city: str) -> str:
    """Current weather for a city."""
    return '{"temp_c": 18, "sky": "cloudy"}'

agent = Agent(name="weather", model="fast", instructions="Use the tool to answer.", tools=[get_weather])
print(Runner.run_sync(agent, "What is the weather in Paris? Use the tool.").final_output)
```

The SDK runs the tool and makes the follow-up request itself.

## Structured output

```python
from pydantic import BaseModel

class Answer(BaseModel):
    answer: str

agent = Agent(name="answer", model="fast", output_type=Answer)
print(Runner.run_sync(agent, "What is 6 times 7?").final_output)  # an Answer
```

## Streaming

`Runner.run_streamed(agent, prompt)` returns a result whose `stream_events()` yields `raw_response_event` items. Text arrives as `response.output_text.delta` events on the Responses path, and as the equivalent deltas on the chat-completions path.

## Gotchas

- Tracing must be off (`set_tracing_disabled(True)`) or it posts to OpenAI.
- The Responses path resends the full history every turn; plugboard serves that statelessly, which is what the SDK expects here.
- Chat Completions needs `set_default_openai_api("chat_completions")` before the first run. It is process-wide, so set it once.

Harness: `compat/py/clients/openai_agents.py`. Example: [`examples/openai-agents/`](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/openai-agents).
