"""S2, tool call and tool-result turn, as two agents. The assistant registers the function for the model, the user agent runs it.
AutoGen does not return the finish reasons, so the runner does not check them."""

import json
from pathlib import Path

from autogen import ConversableAgent

from llm import config

WEATHER = (Path(__file__).resolve().parents[1] / "_shared" / "get_weather.result.json").read_text().strip()
weather_calls: list[str] = []


def get_weather(city: str) -> str:
    """Get the current weather for a city."""
    weather_calls.append(city)
    return WEATHER


def run(model, route="chat"):
    weather_calls.clear()
    cfg = config(model, route)  # llm_config() on the chat route, anthropic_config() on the messages route
    # region snippet
    assistant = ConversableAgent(
        "assistant",
        llm_config=cfg,
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
        message="What is the weather in Paris? Use the tool.",
        max_turns=4,
        silent=True,
    )
    # endregion snippet
    if not weather_calls:
        raise RuntimeError("get_weather was not called")
    call = next(call for message in result.chat_history for call in message.get("tool_calls") or [])
    final = next(str(message["content"]) for message in reversed(result.chat_history) if message.get("content") and message["role"] == "user")
    return {
        "tool_name": call["function"]["name"],
        "tool_city": json.loads(call["function"]["arguments"]).get("city", ""),
        "tool_call_id": call["id"],
        "final_text": final.strip(),
    }


if __name__ == "__main__":
    print(json.dumps(run("fast")))
