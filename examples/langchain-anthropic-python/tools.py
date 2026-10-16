"""S2, tool call and tool-result turn. bind_tools sends the schema; your code runs the tool and sends a ToolMessage back."""

import json
from pathlib import Path

from langchain_core.messages import HumanMessage, ToolMessage

from llm import chat_model, finish_reason, text_of

PROMPT = "What is the weather in Paris? Use the tool."
WEATHER = json.loads((Path(__file__).resolve().parents[1] / "_shared" / "get_weather.result.json").read_text())
GET_WEATHER = {
    "name": "get_weather",
    "description": "Current weather for a city",
    "input_schema": {"type": "object", "properties": {"city": {"type": "string", "description": "City name"}}, "required": ["city"]},
}


def run(model):
    # region snippet
    llm = chat_model(model).bind_tools([GET_WEATHER])
    first = llm.invoke([HumanMessage(PROMPT)])
    call = first.tool_calls[0]
    second = llm.invoke([HumanMessage(PROMPT), first, ToolMessage(content=json.dumps(WEATHER), tool_call_id=call["id"])])
    # endregion snippet
    return {
        "finish_reason": finish_reason(first.response_metadata.get("stop_reason")),
        "tool_name": call["name"],
        "tool_city": str(call["args"].get("city", "")),
        "tool_call_id": call["id"],
        "final_text": text_of(second.content),
        "final_finish_reason": finish_reason(second.response_metadata.get("stop_reason")),
    }


if __name__ == "__main__":
    print(json.dumps(run("fast")))
