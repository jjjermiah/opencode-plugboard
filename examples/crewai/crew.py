# /// script
# requires-python = ">=3.10,<3.14"
# dependencies = ["crewai==1.15.27"]
# ///
"""CrewAI on plugboard (#231): a text call, a stream and a crew task with one tool.

    PLUGBOARD_KEY=<app key> uv run crew.py

The base is passed to LLM(base_url=...). OPENAI_BASE_URL also works as a fallback.
"""

import os

from crewai import LLM, Agent, Crew, Task
from crewai.events import LLMStreamChunkEvent, crewai_event_bus
from crewai.tools import tool

BASE = os.environ.get("PLUGBOARD_URL", "http://127.0.0.1:4010").rstrip("/") + "/v1"
KEY = os.environ["PLUGBOARD_KEY"]
MODEL = "openai/fast"

weather_calls: list[str] = []
stream_chunks: list[str] = []


@tool("get_weather")
def get_weather(city: str) -> str:
    """Get the current weather for a city."""
    weather_calls.append(city)
    return '{"city": "%s", "forecast": "sunny", "celsius": 24}' % city


@crewai_event_bus.on(LLMStreamChunkEvent)
def on_chunk(source, event):
    if event.chunk:
        stream_chunks.append(event.chunk)


def main() -> None:
    llm = LLM(model=MODEL, base_url=BASE, api_key=KEY, max_completion_tokens=1024)

    # 1. Text.
    print("text:", llm.call("Reply with the single word: pong").strip())

    # 2. Stream. Chunks arrive through LLMStreamChunkEvent; call() still returns the full text.
    streaming = LLM(model=MODEL, base_url=BASE, api_key=KEY, max_completion_tokens=1024, stream=True)
    full = streaming.call("Count from 1 to 3, comma separated.")
    print("stream:", full.strip(), f"(chunks: {len(stream_chunks)})")

    # 3. One tool call, through a crew task.
    agent = Agent(
        role="Weather reporter",
        goal="Report the weather for the requested city using the tool",
        backstory="You answer weather questions by calling get_weather.",
        llm=llm,
        tools=[get_weather],
        verbose=False,
    )
    task = Task(
        description="What is the weather in Lisbon? Call get_weather for Lisbon, then answer.",
        expected_output="One sentence with the weather in Lisbon.",
        agent=agent,
    )
    result = Crew(agents=[agent], tasks=[task], verbose=False).kickoff()
    print("tool calls:", weather_calls)
    print("crew answer:", str(result).strip())
    if not weather_calls:
        raise SystemExit("get_weather was not called")


if __name__ == "__main__":
    main()
