# /// script
# requires-python = ">=3.10"
# dependencies = ["smolagents[openai]"]
# ///
"""smolagents through plugboard: text, streaming if the model supports it, and a tool-calling agent.

Run: PLUGBOARD_KEY=<app key> uv run example.py
PLUGBOARD_URL is the base with /v1 (default http://127.0.0.1:4010/v1).
"""

import os
import sys

from smolagents import OpenAIModel, ToolCallingAgent, tool

URL = os.environ.get("PLUGBOARD_URL", "http://127.0.0.1:4010/v1")
KEY = os.environ["PLUGBOARD_KEY"]


@tool
def get_weather(city: str) -> str:
    """Current weather for a city.

    Args:
        city: The city name.
    """
    return '{"temp_c": 18, "sky": "cloudy"}'


def check(name: str, ok: bool, detail: str = "") -> bool:
    print(f"{name}: {'pass' if ok else 'fail'} {detail}".rstrip())
    return ok


def main() -> int:
    model = OpenAIModel(model_id="fast", api_base=URL, api_key=KEY, max_completion_tokens=1024)
    results = []

    msg = model.generate([{"role": "user", "content": [{"type": "text", "text": "Reply with exactly: pong"}]}])
    text = msg.content or ""
    results.append(check("text", "pong" in text.lower(), repr(text[:40])))

    if hasattr(model, "generate_stream"):
        deltas = [d for d in model.generate_stream([{"role": "user", "content": [{"type": "text", "text": "Reply with exactly: pong"}]}]) if getattr(d, "content", None)]
        streamed = "".join(d.content for d in deltas)
        results.append(check("stream", len(deltas) > 0 and "pong" in streamed.lower(), f"{len(deltas)} deltas"))
    else:
        results.append(check("stream", False, "model has no generate_stream; not exercised"))

    agent = ToolCallingAgent(tools=[get_weather], model=model, max_steps=4)
    answer = str(agent.run("What is the weather in Paris? Use the tool."))
    tool_steps = [s for s in agent.memory.steps if getattr(s, "tool_calls", None)]
    called = any(c.name == "get_weather" for s in tool_steps for c in s.tool_calls)
    results.append(check("tool call", called, f"{len(tool_steps)} step(s) with tool calls"))
    results.append(check("tool round trip", "18" in answer or "cloud" in answer.lower(), repr(answer[:60])))

    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
