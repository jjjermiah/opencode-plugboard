"""S4, streaming tool call. The chunks are merged into one message; its tool_calls hold the assembled call."""

from langchain_core.messages import HumanMessage

from llm import chat_model, finish_reason
from tools import GET_WEATHER, PROMPT


def run(model):
    # region snippet
    merged = None
    stop_reason = None
    for chunk in chat_model(model).bind_tools([GET_WEATHER]).stream([HumanMessage(PROMPT)]):
        merged = chunk if merged is None else merged + chunk
        # The last chunk (the message_delta) carries the stop reason in response_metadata.
        if chunk.response_metadata.get("stop_reason"):
            stop_reason = chunk.response_metadata["stop_reason"]
    # endregion snippet
    call = merged.tool_calls[0] if merged is not None and merged.tool_calls else None
    return {
        "finish_reason": finish_reason(stop_reason),
        "tool_name": call["name"] if call else "",
        "tool_city": str(call["args"].get("city", "")) if call else "",
        "tool_call_id": call["id"] if call else "",
    }


if __name__ == "__main__":
    import json

    print(json.dumps(run("fast")))
