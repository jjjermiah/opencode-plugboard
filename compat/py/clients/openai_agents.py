"""OpenAI Agents SDK (openai-agents, #221) against plugboard.

Runs each scenario twice: on the default Responses path (`/v1/responses`) and on the Chat
Completions path (`set_default_openai_api("chat_completions")`, `/v1/chat/completions`).
Run through `bun run compat:python`, or directly with PLUGBOARD_URL and PLUGBOARD_KEY set.
"""

import asyncio

from _common import MODEL, PONG_PROMPT, WEATHER_PROMPT, api_key, base_url, main, require
from agents import (
    Agent,
    Runner,
    function_tool,
    set_default_openai_api,
    set_default_openai_client,
    set_tracing_disabled,
)
from openai import AsyncOpenAI
from pydantic import BaseModel

CLIENT = "openai-agents"
tool_calls: list[str] = []


class Answer(BaseModel):
    answer: str


@function_tool
def get_weather(city: str) -> str:
    """Current weather for a city."""
    tool_calls.append(city)
    return '{"temp_c": 18, "sky": "cloudy"}'


def configure(api: str) -> None:
    # One client for the whole run; tracing goes nowhere (it would call OpenAI otherwise).
    set_default_openai_client(AsyncOpenAI(base_url=base_url(), api_key=api_key()), use_for_tracing=False)
    set_default_openai_api(api)
    set_tracing_disabled(True)


def text(api: str) -> str:
    configure(api)
    agent = Agent(name="pong", model=MODEL, instructions="Answer tersely.")
    out = Runner.run_sync(agent, PONG_PROMPT).final_output
    require("pong" in str(out).lower(), f"final_output={out!r}")
    return f"final={out!r}"


def stream(api: str) -> str:
    configure(api)

    async def go() -> tuple[int, str]:
        agent = Agent(name="pong", model=MODEL, instructions="Answer tersely.")
        result = Runner.run_streamed(agent, PONG_PROMPT)
        deltas = 0
        async for event in result.stream_events():
            if event.type == "raw_response_event" and getattr(event.data, "type", "") == "response.output_text.delta":
                deltas += 1
        return deltas, str(result.final_output)

    deltas, out = asyncio.run(go())
    require(deltas >= 1, f"no text delta events (final={out!r})")
    require("pong" in out.lower(), f"final={out!r}")
    return f"text_deltas={deltas} final={out!r}"


def tool(api: str) -> str:
    configure(api)
    tool_calls.clear()
    agent = Agent(name="weather", model=MODEL, instructions="Use the tool.", tools=[get_weather])
    out = str(Runner.run_sync(agent, WEATHER_PROMPT).final_output)
    require(tool_calls == ["Paris"], f"tool calls={tool_calls}")
    require("18" in out or "cloud" in out.lower(), f"final={out!r}")
    return f"tool_calls={tool_calls} final={out!r}"


def structured(api: str) -> str:
    configure(api)
    agent = Agent(name="answer", model=MODEL, instructions="Answer with the answer field.", output_type=Answer)
    out = Runner.run_sync(agent, "What is 6 times 7? Give the number as a string.").final_output
    require(isinstance(out, Answer), f"output is {type(out).__name__}: {out!r}")
    return f"output={out.model_dump()}"


SCENARIOS = []
for api in ("responses", "chat_completions"):
    SCENARIOS += [
        (f"{api}:text", lambda api=api: text(api)),
        (f"{api}:stream", lambda api=api: stream(api)),
        (f"{api}:tool", lambda api=api: tool(api)),
        (f"{api}:structured", lambda api=api: structured(api)),
    ]

if __name__ == "__main__":
    main(CLIENT, SCENARIOS)
