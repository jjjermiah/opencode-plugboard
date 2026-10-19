"""S4, streaming tool call. Gemini sends each function call whole in one chunk, with its full args."""

import json

from langchain_core.messages import HumanMessage
from langchain_core.tools import tool

from tools import get_weather


def run(client, model):
    # region snippet
    llm = client(model).bind_tools([get_weather])
    call = None
    finish = None
    for chunk in llm.stream([HumanMessage("What is the weather in Paris? Use the tool.")]):
        if chunk.tool_call_chunks:
            call = chunk.tool_call_chunks[0]  # name, args (a JSON string) and id; one chunk holds the whole call
        finish = chunk.response_metadata.get("finish_reason") or finish
    # endregion snippet
    args = json.loads(call["args"]) if call and call.get("args") else {}
    return {
        "finish_reason": "tool_calls" if call else (finish.lower() if finish else None),
        "tool_name": call["name"] if call else None,
        "tool_city": args.get("city", ""),
        "tool_call_id": call["id"] if call else None,
    }


if __name__ == "__main__":
    from llm import chat_model

    print(json.dumps(run(chat_model, "fast")))
