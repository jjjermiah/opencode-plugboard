# /// script
# requires-python = ">=3.10"
# dependencies = ["llama-index-llms-openai", "llama-index-llms-openai-like"]
# ///
"""LlamaIndex through plugboard: text, stream, a tool round trip, and OpenAILike.

Run: PLUGBOARD_KEY=<app key> uv run example.py
PLUGBOARD_URL is the base with /v1 (default http://127.0.0.1:4010/v1).
"""

import os
import sys

from llama_index.core.llms import ChatMessage, MessageRole
from llama_index.core.tools import FunctionTool
from llama_index.llms.openai_like import OpenAILike

URL = os.environ.get("PLUGBOARD_URL", "http://127.0.0.1:4010/v1")
KEY = os.environ["PLUGBOARD_KEY"]


def get_weather(city: str) -> str:
    """Current weather for a city."""
    return '{"temp_c": 18, "sky": "cloudy"}'


def check(name: str, ok: bool, detail: str = "") -> bool:
    print(f"{name}: {'pass' if ok else 'fail'} {detail}".rstrip())
    return ok


def main() -> int:
    # region snippet
    # The OpenAI class looks up the model name in OpenAI's own table and raises for `fast`,
    # so plugboard ids need OpenAILike with the capability flags set.
    llm = OpenAILike(
        model="fast",
        api_base=URL,
        api_key=KEY,
        context_window=200000,
        is_chat_model=True,
        is_function_calling_model=True,
    )
    # endregion snippet
    results = []

    text = llm.complete("Reply with exactly: pong").text
    results.append(check("text", "pong" in text.lower(), repr(text[:40])))

    chunks = [c.delta for c in llm.stream_complete("Reply with exactly: pong") if c.delta]
    streamed = "".join(chunks)
    results.append(check("stream", len(chunks) > 0 and "pong" in streamed.lower(), f"{len(chunks)} deltas"))

    tool = FunctionTool.from_defaults(fn=get_weather)
    user = ChatMessage(role=MessageRole.USER, content="What is the weather in Paris? Use the tool.")
    resp = llm.chat_with_tools([tool], chat_history=[user], tool_required=True)
    calls = llm.get_tool_calls_from_response(resp, error_on_no_tool_call=False)
    called = bool(calls) and calls[0].tool_name == "get_weather"
    results.append(check("tool call", called, f"{len(calls)} call(s)"))

    if called:
        tool_msg = ChatMessage(
            role=MessageRole.TOOL,
            content=get_weather(**calls[0].tool_kwargs),
            additional_kwargs={"tool_call_id": calls[0].tool_id, "name": calls[0].tool_name},
        )
        follow = llm.chat([user, resp.message, tool_msg]).message.content or ""
        results.append(check("tool round trip", "18" in follow or "cloud" in follow.lower(), repr(follow[:60])))
    else:
        results.append(check("tool round trip", False, "skipped: no tool call"))

    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
