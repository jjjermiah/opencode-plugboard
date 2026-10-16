"""Runner for the LlamaIndex example: OpenAILike through plugboard. Started by examples/_harness/run.ts, which captures
the traffic and writes the run. This file writes nothing: it prints one JSON line per scenario and model.

    uv run --frozen run.py          # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness

The scenarios are the ones in example.py: S1 text, S2 tool round trip, S3 stream, S4 streaming tool call.
S5 to S7 and E1/E2 are not in this runner yet.
"""

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHARED = ROOT / "_shared"
sys.path.insert(0, str(ROOT / "_harness" / "py"))

import harness  # noqa: E402
from llama_index.core.llms import ChatMessage, MessageRole  # noqa: E402
from llama_index.core.tools import FunctionTool  # noqa: E402
from llama_index.llms.openai_like import OpenAILike  # noqa: E402

PROMPT = "Reply with exactly: pong"
TOOL_PROMPT = "What is the weather in Paris? Use the tool."
TOOL_RESULT = (SHARED / "get_weather.result.json").read_text().strip()


def get_weather(city: str) -> str:
    """Current weather for a city."""
    return TOOL_RESULT


def make_llm(model: str) -> OpenAILike:
    # The OpenAI class looks up the model name in OpenAI's own table and raises for `fast`,
    # so plugboard ids need OpenAILike with the capability flags set.
    return OpenAILike(
        model=model,
        api_base=os.environ["PLUGBOARD_BASE_URL"],
        api_key=os.environ["PLUGBOARD_KEY"],
        context_window=200000,
        is_chat_model=True,
        is_function_calling_model=True,
        max_tokens=1024,
    )


def user_message(text: str) -> ChatMessage:
    return ChatMessage(role=MessageRole.USER, content=text)


def s1(model: str) -> dict:
    llm = make_llm(model)
    response = llm.chat([user_message(PROMPT)])
    raw = response.raw
    return {
        "text": response.message.content or "",
        "finish_reason": raw.choices[0].finish_reason,
        "usage": raw.usage.model_dump(exclude_none=True) if raw.usage else None,
    }


def s2(model: str) -> dict:
    llm = make_llm(model)
    tool = FunctionTool.from_defaults(fn=get_weather)
    user = user_message(TOOL_PROMPT)
    first = llm.chat_with_tools([tool], chat_history=[user], tool_required=True)
    call = llm.get_tool_calls_from_response(first, error_on_no_tool_call=False)[0]
    # The assistant turn goes back as LlamaIndex built it, then the result under the same call id.
    tool_message = ChatMessage(
        role=MessageRole.TOOL,
        content=get_weather(**call.tool_kwargs),
        additional_kwargs={"tool_call_id": call.tool_id, "name": call.tool_name},
    )
    second = llm.chat([user, first.message, tool_message])
    return {
        "finish_reason": first.raw.choices[0].finish_reason,
        "tool_name": call.tool_name,
        "tool_city": call.tool_kwargs.get("city", ""),
        "tool_call_id": call.tool_id,
        "final_text": second.message.content or "",
        "final_finish_reason": second.raw.choices[0].finish_reason,
    }


def s3(model: str) -> dict:
    llm = make_llm(model)
    text, finish = "", None
    for chunk in llm.stream_chat([user_message(PROMPT)]):
        text += chunk.delta or ""
        if chunk.raw is not None and chunk.raw.choices:
            finish = chunk.raw.choices[0].finish_reason or finish
    return {"text": text, "finish_reason": finish, "done": True}


def s4(model: str) -> dict:
    llm = make_llm(model)
    tool = FunctionTool.from_defaults(fn=get_weather)
    call_id, name, arguments, finish = None, None, "", None
    for chunk in llm.stream_chat_with_tools([tool], chat_history=[user_message(TOOL_PROMPT)], tool_required=True):
        if chunk.raw is None or not chunk.raw.choices:
            continue
        choice = chunk.raw.choices[0]
        finish = choice.finish_reason or finish
        for delta in choice.delta.tool_calls or []:
            call_id = delta.id or call_id
            if delta.function is not None:
                name = delta.function.name or name
                arguments += delta.function.arguments or ""
    return {
        "finish_reason": finish,
        "tool_name": name or "",
        "tool_city": json.loads(arguments or "{}").get("city", ""),
        "tool_call_id": call_id,
    }


def main() -> None:
    harness.emit_client("llama-index-llms-openai-like")
    harness.run_all(
        {"S1": s1, "S2": s2, "S3": s3, "S4": s4},
        # LlamaIndex's stream_chat does not send stream_options include_usage, so no usage chunk is read.
        unobserved={"S3": {"usage chunk present when requested": "LlamaIndex stream_chat does not request a usage chunk"}},
    )


if __name__ == "__main__":
    main()
