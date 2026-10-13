# /// script
# requires-python = ">=3.10"
# dependencies = ["semantic-kernel==1.45.0"]
# ///
"""Semantic Kernel (Python) on plugboard (#229), OpenAI Chat Completions route.

    PLUGBOARD_KEY=<app key> uv run chat.py

A text reply, a streamed reply, and a plugin function call made through
automatic function calling.
"""

import os

from openai import AsyncOpenAI
from semantic_kernel import Kernel
from semantic_kernel.connectors.ai.function_choice_behavior import FunctionChoiceBehavior
from semantic_kernel.connectors.ai.open_ai import OpenAIChatCompletion, OpenAIChatPromptExecutionSettings
from semantic_kernel.contents import ChatHistory
from semantic_kernel.functions import kernel_function

BASE = os.environ.get("PLUGBOARD_URL", "http://127.0.0.1:4010").rstrip("/") + "/v1"
KEY = os.environ["PLUGBOARD_KEY"]

weather_calls: list[str] = []


class WeatherPlugin:
    @kernel_function(name="get_weather", description="Get the current weather for a city.")
    def get_weather(self, city: str) -> str:
        weather_calls.append(city)
        return '{"city": "%s", "forecast": "sunny", "celsius": 24}' % city


def make_service() -> OpenAIChatCompletion:
    # The client is passed in; do not also pass api_key or base_url to the service (they conflict).
    client = AsyncOpenAI(base_url=BASE, api_key=KEY)
    return OpenAIChatCompletion(ai_model_id="fast", async_client=client)


def user(text: str) -> ChatHistory:
    history = ChatHistory()
    history.add_user_message(text)
    return history


async def main() -> None:
    service = make_service()
    settings = OpenAIChatPromptExecutionSettings(max_completion_tokens=1024)

    # 1. Text.
    reply = await service.get_chat_message_content(chat_history=user("Reply with the single word: pong"), settings=settings)
    print("text:", str(reply).strip())

    # 2. Stream.
    chunks = 0
    parts: list[str] = []
    async for update in service.get_streaming_chat_message_content(
        chat_history=user("Count from 1 to 3, comma separated."), settings=settings
    ):
        if update.content:
            chunks += 1
            parts.append(str(update.content))
    print("stream:", "".join(parts).strip(), f"(chunks: {chunks})")

    # 3. Plugin function call through automatic function calling.
    kernel = Kernel()
    kernel.add_service(service)
    kernel.add_plugin(WeatherPlugin(), plugin_name="weather")
    tool_settings = OpenAIChatPromptExecutionSettings(
        max_completion_tokens=1024,
        function_choice_behavior=FunctionChoiceBehavior.Auto(auto_invoke=True),
    )
    answer = await service.get_chat_message_content(
        chat_history=user("What is the weather in Lisbon? Use the tool."),
        settings=tool_settings,
        kernel=kernel,
    )
    print("plugin calls:", weather_calls)
    print("tool answer:", str(answer).strip())
    if not weather_calls:
        raise SystemExit("get_weather was not called")


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
