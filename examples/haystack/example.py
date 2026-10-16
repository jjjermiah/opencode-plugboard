# /// script
# requires-python = ">=3.10"
# dependencies = ["haystack-ai"]
# ///
"""Haystack through plugboard: a two-component pipeline, streaming, and a tool round trip.

Run: PLUGBOARD_KEY=<app key> uv run example.py
PLUGBOARD_URL is the base with /v1 (default http://127.0.0.1:4010/v1).
"""

import os
import sys

from haystack import Pipeline
from haystack.components.builders import ChatPromptBuilder
from haystack.components.generators.chat import OpenAIChatGenerator
from haystack.dataclasses import ChatMessage
from haystack.tools import Tool
from haystack.utils import Secret

URL = os.environ.get("PLUGBOARD_URL", "http://127.0.0.1:4010/v1")
KEY = os.environ["PLUGBOARD_KEY"]


def get_weather(city: str) -> str:
    return '{"temp_c": 18, "sky": "cloudy"}'


def check(name: str, ok: bool, detail: str = "") -> bool:
    print(f"{name}: {'pass' if ok else 'fail'} {detail}".rstrip())
    return ok


def main() -> int:
    results = []
    chunks: list[str] = []

    # region snippet
    generator = OpenAIChatGenerator(
        model="fast",
        api_base_url=URL,
        api_key=Secret.from_token(KEY),
        streaming_callback=lambda chunk: chunks.append(chunk.content or ""),
    )
    prompt = ChatPromptBuilder(
        template=[ChatMessage.from_user("{{ question }}")],
        required_variables=["question"],
    )
    pipe = Pipeline()
    pipe.add_component("prompt", prompt)
    pipe.add_component("llm", generator)
    pipe.connect("prompt.prompt", "llm.messages")
    # endregion snippet

    out = pipe.run({"prompt": {"question": "Reply with exactly: pong"}})
    text = out["llm"]["replies"][0].text or ""
    results.append(check("text (pipeline)", "pong" in text.lower(), repr(text[:40])))

    streamed = "".join(chunks)
    results.append(check("stream", len(chunks) > 0 and "pong" in streamed.lower(), f"{len(chunks)} chunks"))

    tool = Tool(
        name="get_weather",
        description="Current weather for a city.",
        parameters={
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"],
        },
        function=get_weather,
    )
    tool_gen = OpenAIChatGenerator(model="fast", api_base_url=URL, api_key=Secret.from_token(KEY), tools=[tool])
    first = tool_gen.run(messages=[ChatMessage.from_user("What is the weather in Paris? Use the tool.")])
    calls = first["replies"][0].tool_calls
    called = bool(calls) and calls[0].tool_name == "get_weather"
    results.append(check("tool call", called, f"{len(calls)} call(s)"))

    if called:
        result = tool.invoke(**calls[0].arguments)
        follow = tool_gen.run(
            messages=[
                ChatMessage.from_user("What is the weather in Paris? Use the tool."),
                first["replies"][0],
                ChatMessage.from_tool(tool_result=result, origin=calls[0]),
            ]
        )
        answer = follow["replies"][0].text or ""
        results.append(check("tool round trip", "18" in answer or "cloud" in answer.lower(), repr(answer[:60])))
    else:
        results.append(check("tool round trip", False, "skipped: no tool call"))

    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
