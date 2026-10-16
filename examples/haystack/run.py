"""Runner for the Haystack example: OpenAIChatGenerator through plugboard. Started by examples/_harness/run.ts, which
captures the traffic and writes the run. This file writes nothing: it prints one JSON line per scenario and model.

    uv run --frozen run.py          # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness

The scenarios are the ones in example.py: S1 text through the two-component pipeline, S2 tool round trip, S3 stream,
S4 streamed tool call. S5 to S7 and E1/E2 are not in this runner yet.
"""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHARED = ROOT / "_shared"
sys.path.insert(0, str(ROOT / "_harness" / "py"))

import harness  # noqa: E402
from haystack import Pipeline  # noqa: E402
from haystack.components.builders import ChatPromptBuilder  # noqa: E402
from haystack.components.generators.chat import OpenAIChatGenerator  # noqa: E402
from haystack.dataclasses import ChatMessage, StreamingChunk  # noqa: E402
from haystack.tools import Tool  # noqa: E402
from haystack.utils import Secret  # noqa: E402

PROMPT = "Reply with exactly: pong"
TOOL_PROMPT = "What is the weather in Paris? Use the tool."
TOOL_RESULT = (SHARED / "get_weather.result.json").read_text().strip()


def get_weather(city: str) -> str:
    return TOOL_RESULT


def tool() -> Tool:
    return Tool(
        name="get_weather",
        description="Current weather for a city.",
        parameters={"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]},
        function=get_weather,
    )


def generator(model: str, generation_kwargs: dict | None = None, **extra) -> OpenAIChatGenerator:
    return OpenAIChatGenerator(
        model=model,
        api_base_url=os.environ["PLUGBOARD_BASE_URL"],
        api_key=Secret.from_token(os.environ["PLUGBOARD_KEY"]),
        generation_kwargs={"max_completion_tokens": 1024, **(generation_kwargs or {})},
        **extra,
    )


def s1(model: str) -> dict:
    prompt = ChatPromptBuilder(template=[ChatMessage.from_user("{{ question }}")], required_variables=["question"])
    pipe = Pipeline()
    pipe.add_component("prompt", prompt)
    pipe.add_component("llm", generator(model))
    pipe.connect("prompt.prompt", "llm.messages")
    reply = pipe.run({"prompt": {"question": PROMPT}})["llm"]["replies"][0]
    return {"text": reply.text or "", "finish_reason": reply.meta.get("finish_reason"), "usage": reply.meta.get("usage")}


def s2(model: str) -> dict:
    gen = generator(model, tools=[tool()])
    user = ChatMessage.from_user(TOOL_PROMPT)
    first = gen.run(messages=[user])["replies"][0]
    call = first.tool_calls[0]
    # The assistant turn goes back as Haystack built it, then the result under the same call id.
    follow = gen.run(messages=[user, first, ChatMessage.from_tool(tool_result=get_weather(**call.arguments), origin=call)])["replies"][0]
    return {
        "finish_reason": first.meta.get("finish_reason"),
        "tool_name": call.tool_name,
        "tool_city": call.arguments.get("city", ""),
        "tool_call_id": call.id,
        "final_text": follow.text or "",
        "final_finish_reason": follow.meta.get("finish_reason"),
    }


def s3(model: str) -> dict:
    chunks: list[StreamingChunk] = []
    # Haystack sends no stream_options unless asked: request the usage chunk the check reads.
    gen = generator(model, generation_kwargs={"stream_options": {"include_usage": True}}, streaming_callback=chunks.append)
    reply = gen.run(messages=[ChatMessage.from_user(PROMPT)])["replies"][0]
    return {
        "text": "".join(chunk.content or "" for chunk in chunks),
        "finish_reason": reply.meta.get("finish_reason"),
        "usage": reply.meta.get("usage"),
        "done": True,
    }


def s4(model: str) -> dict:
    gen = generator(model, tools=[tool()], streaming_callback=lambda chunk: None)
    reply = gen.run(messages=[ChatMessage.from_user(TOOL_PROMPT)])["replies"][0]
    call = reply.tool_calls[0]
    return {
        "finish_reason": reply.meta.get("finish_reason"),
        "tool_name": call.tool_name,
        "tool_city": call.arguments.get("city", ""),
        "tool_call_id": call.id,
    }


def main() -> None:
    harness.emit_client("haystack-ai")
    harness.run_all({"S1": s1, "S2": s2, "S3": s3, "S4": s4})


if __name__ == "__main__":
    main()
