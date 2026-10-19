"""Runner for the Semantic Kernel example: Semantic Kernel (Python) through plugboard. Started by examples/_harness/run.ts,
which captures the traffic and writes the run. This file writes nothing: it prints one JSON line per scenario and model.

    uv run --frozen run.py          # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness

The scenarios are the ones in chat.py: S1 text, S2 tool round trip (the calls are made by hand), S3 stream,
S4 streamed tool call. S5 to S7 and E1/E2 are not in this runner yet.
"""

import asyncio
import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHARED = ROOT / "_shared"
sys.path.insert(0, str(ROOT / "_harness" / "py"))

import harness  # noqa: E402
from openai import AsyncOpenAI  # noqa: E402
from semantic_kernel import Kernel  # noqa: E402
from semantic_kernel.connectors.ai.function_choice_behavior import FunctionChoiceBehavior  # noqa: E402
from semantic_kernel.connectors.ai.open_ai import OpenAIChatCompletion, OpenAIChatPromptExecutionSettings  # noqa: E402
from semantic_kernel.contents import AuthorRole, ChatHistory, ChatMessageContent, FunctionCallContent, FunctionResultContent  # noqa: E402
from semantic_kernel.functions import kernel_function  # noqa: E402

PROMPT = "Reply with exactly: pong"
TOOL_PROMPT = "What is the weather in Paris? Use the tool."
TOOL_RESULT = (SHARED / "get_weather.result.json").read_text().strip()


class WeatherPlugin:
    @kernel_function(name="get_weather", description="Current weather for a city.")
    def get_weather(self, city: str) -> str:
        return TOOL_RESULT


@asynccontextmanager
async def make_service(model: str):
    # The client is passed in; do not also pass api_key or base_url to the service (they conflict).
    client = AsyncOpenAI(base_url=os.environ["PLUGBOARD_BASE_URL"], api_key=os.environ["PLUGBOARD_KEY"])
    try:
        yield OpenAIChatCompletion(ai_model_id=model, async_client=client)
    finally:
        await client.close()


def history(text: str) -> ChatHistory:
    chat = ChatHistory()
    chat.add_user_message(text)
    return chat


def plain_settings() -> OpenAIChatPromptExecutionSettings:
    return OpenAIChatPromptExecutionSettings(max_completion_tokens=1024)


def manual_tool_settings() -> OpenAIChatPromptExecutionSettings:
    # auto_invoke=False hands the function call back to the runner, so the round trip is visible.
    return OpenAIChatPromptExecutionSettings(
        max_completion_tokens=1024,
        function_choice_behavior=FunctionChoiceBehavior.Auto(auto_invoke=False),
    )


def finish_of(item) -> str | None:
    reason = item.finish_reason
    return None if reason is None else getattr(reason, "value", reason)


def usage_of(item) -> dict | None:
    usage = item.metadata.get("usage")
    if usage is None:
        return None
    if hasattr(usage, "model_dump"):
        return usage.model_dump(exclude_none=True)
    return {key: value for key, value in vars(usage).items() if value is not None}


def call_args(call: FunctionCallContent) -> dict:
    return json.loads(call.arguments) if isinstance(call.arguments, str) else dict(call.arguments or {})


def kernel_for(service: OpenAIChatCompletion) -> Kernel:
    kernel = Kernel()
    kernel.add_service(service)
    kernel.add_plugin(WeatherPlugin(), plugin_name="weather")
    return kernel


async def _s1(model: str) -> dict:
    async with make_service(model) as service:
        reply = await service.get_chat_message_content(chat_history=history(PROMPT), settings=plain_settings())
    return {"text": str(reply), "finish_reason": finish_of(reply), "usage": usage_of(reply)}


async def _s2(model: str) -> dict:
    async with make_service(model) as service:
        kernel = kernel_for(service)
        chat = history(TOOL_PROMPT)
        first = await service.get_chat_message_content(chat_history=chat, settings=manual_tool_settings(), kernel=kernel)
        call = next(item for item in first.items if isinstance(item, FunctionCallContent))
        # The assistant turn goes back as SK built it, then the result under the same call id.
        chat.add_message(first)
        chat.add_message(
            ChatMessageContent(
                role=AuthorRole.TOOL,
                items=[FunctionResultContent.from_function_call_content_and_result(function_call_content=call, result=TOOL_RESULT)],
            )
        )
        second = await service.get_chat_message_content(chat_history=chat, settings=manual_tool_settings(), kernel=kernel)
    return {
        "finish_reason": finish_of(first),
        "tool_name": call.function_name,
        "tool_city": call_args(call).get("city", ""),
        "tool_call_id": call.id,
        "final_text": str(second),
        "final_finish_reason": finish_of(second),
    }


async def _s3(model: str) -> dict:
    parts: list[str] = []
    finish, usage = None, None
    async with make_service(model) as service:
        async for update in service.get_streaming_chat_message_content(chat_history=history(PROMPT), settings=plain_settings()):
            if update.content:
                parts.append(str(update.content))
            finish = finish_of(update) or finish
            usage = usage_of(update) or usage
    return {"text": "".join(parts), "finish_reason": finish, "usage": usage, "done": True}


async def _s4(model: str) -> dict:
    async with make_service(model) as service:
        kernel = kernel_for(service)
        merged, finish = None, None
        async for update in service.get_streaming_chat_message_content(chat_history=history(TOOL_PROMPT), settings=manual_tool_settings(), kernel=kernel):
            finish = finish_of(update) or finish
            merged = update if merged is None else merged + update
    call = next(item for item in merged.items if isinstance(item, FunctionCallContent))
    return {
        "finish_reason": finish,
        "tool_name": call.function_name,
        "tool_city": call_args(call).get("city", ""),
        "tool_call_id": call.id,
    }


def s1(model: str) -> dict:
    return asyncio.run(_s1(model))


def s2(model: str) -> dict:
    return asyncio.run(_s2(model))


def s3(model: str) -> dict:
    return asyncio.run(_s3(model))


def s4(model: str) -> dict:
    return asyncio.run(_s4(model))


def main() -> None:
    harness.emit_client("semantic-kernel")
    harness.run_all({"S1": s1, "S2": s2, "S3": s3, "S4": s4})


if __name__ == "__main__":
    main()
