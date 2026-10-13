# /// script
# requires-python = ">=3.10"
# dependencies = ["autogen==0.14.1"]
# ///
"""AutoGen (classic config_list / ConversableAgent API) on plugboard (#230).

    PLUGBOARD_KEY=<app key> uv run chat.py

Package: autogen 0.14.1 on PyPI. ag2 1.x is a redesigned API with no
ConversableAgent, so this example does not use it.

A text reply, a streamed reply, and a two-agent chat in which the assistant
calls one tool.
"""

import os

from autogen import ConversableAgent, LLMConfig

BASE = os.environ.get("PLUGBOARD_URL", "http://127.0.0.1:4010").rstrip("/") + "/v1"
KEY = os.environ["PLUGBOARD_KEY"]

weather_calls: list[str] = []


def llm_config(stream: bool = False) -> LLMConfig:
    return LLMConfig(
        {
            "api_type": "openai",
            "model": "fast",
            "base_url": BASE,
            "api_key": KEY,
            "max_tokens": 1024,
            "stream": stream,
        }
    )


def get_weather(city: str) -> str:
    """Get the current weather for a city."""
    weather_calls.append(city)
    return '{"city": "%s", "forecast": "sunny", "celsius": 24}' % city


def main() -> None:
    # 1. Text.
    bot = ConversableAgent("bot", llm_config=llm_config(), human_input_mode="NEVER")
    reply = bot.generate_reply(messages=[{"role": "user", "content": "Reply with the single word: pong"}])
    print("text:", str(reply).strip())

    # 2. Stream (llm_config stream=True).
    streamer = ConversableAgent("streamer", llm_config=llm_config(stream=True), human_input_mode="NEVER")
    reply = streamer.generate_reply(messages=[{"role": "user", "content": "Count from 1 to 3, comma separated."}])
    print("stream:", str(reply).strip())

    # 3. Two-agent chat with one tool call.
    assistant = ConversableAgent(
        "assistant",
        llm_config=llm_config(),
        human_input_mode="NEVER",
        system_message="Answer weather questions by calling get_weather.",
    )
    user = ConversableAgent(
        "user",
        llm_config=False,
        human_input_mode="NEVER",
        default_auto_reply="",
        is_termination_msg=lambda m: False,
    )
    assistant.register_for_llm(description="Get the current weather for a city.")(get_weather)
    user.register_for_execution()(get_weather)
    result = user.initiate_chat(
        assistant,
        message="What is the weather in Lisbon? Use the tool.",
        max_turns=4,
        silent=True,
    )
    print("tool calls:", weather_calls)
    last = next(str(m["content"]) for m in reversed(result.chat_history) if m.get("content"))
    print("chat last:", last.strip()[:200])
    if not weather_calls:
        raise SystemExit("get_weather was not called")


if __name__ == "__main__":
    main()
