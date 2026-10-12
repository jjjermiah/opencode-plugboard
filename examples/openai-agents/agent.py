# /// script
# requires-python = ">=3.12"
# dependencies = ["openai-agents==0.23.1"]
# ///
"""A one-tool agent on plugboard, with the OpenAI Agents SDK (#221).

    PLUGBOARD_URL=http://127.0.0.1:4010 PLUGBOARD_KEY=<app key> uv run agent.py
    PLUGBOARD_API=chat_completions uv run agent.py     # Chat Completions instead of Responses

Plugboard serves /v1/responses (the SDK default) and /v1/chat/completions.
"""

import os

from agents import Agent, Runner, function_tool, set_default_openai_api, set_default_openai_client, set_tracing_disabled
from openai import AsyncOpenAI


@function_tool
def get_weather(city: str) -> str:
    """Current weather for a city."""
    return '{"temp_c": 18, "sky": "cloudy"}'


base = os.environ.get("PLUGBOARD_URL", "http://127.0.0.1:4010").rstrip("/")
set_default_openai_client(AsyncOpenAI(base_url=f"{base}/v1", api_key=os.environ["PLUGBOARD_KEY"]), use_for_tracing=False)
set_default_openai_api(os.environ.get("PLUGBOARD_API", "responses"))  # or "chat_completions"
set_tracing_disabled(True)

agent = Agent(name="weather", model="fast", instructions="Use the tool to answer.", tools=[get_weather])
print(Runner.run_sync(agent, "What is the weather in Paris? Use the tool.").final_output)
