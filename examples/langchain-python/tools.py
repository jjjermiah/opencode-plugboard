"""S2, tool call and tool-result turn. The model asks for get_weather, the app answers, the model finishes."""

import json
from pathlib import Path

from langchain_core.messages import HumanMessage, ToolMessage
from langchain_core.tools import tool

TOOL_RESULT = (Path(__file__).resolve().parents[1] / "_shared" / "get_weather.result.json").read_text().strip()
PROMPT = "What is the weather in Paris? Use the tool."


# region snippet-tool
@tool
def get_weather(city: str) -> str:
    """Current weather for a city."""
    return TOOL_RESULT


# endregion snippet-tool


def run(client, model):
    messages = [HumanMessage(PROMPT)]
    # region snippet-round-trip
    llm = client(model).bind_tools([get_weather])
    first = llm.invoke(messages)
    call = first.tool_calls[0]  # {"name", "args", "id"}; the id goes back on the ToolMessage
    messages += [first, ToolMessage(content=get_weather.invoke(call["args"]), tool_call_id=call["id"])]
    second = llm.invoke(messages)
    # endregion snippet-round-trip
    return {
        "finish_reason": first.response_metadata.get("finish_reason"),
        "tool_name": call["name"],
        "tool_city": call["args"].get("city", ""),
        "tool_call_id": call["id"],
        "final_text": str(second.content),
        "final_finish_reason": second.response_metadata.get("finish_reason"),
    }


if __name__ == "__main__":
    from llm import chat_model

    print(json.dumps(run(chat_model, "fast")))
