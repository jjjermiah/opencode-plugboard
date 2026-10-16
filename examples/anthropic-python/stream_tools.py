"""S4, streaming tool call. get_final_message() assembles the streamed tool_use block, so the call is whole when it returns."""

from provider import client, finish_reason
from tools import PROMPT, TOOLS


def run(model):
    # region snippet
    with client.messages.stream(model=model, max_tokens=1024, tools=TOOLS, messages=[{"role": "user", "content": PROMPT}]) as stream:
        message = stream.get_final_message()
    # endregion snippet
    call = next((block for block in message.content if block.type == "tool_use"), None)
    return {
        "finish_reason": finish_reason(message.stop_reason),
        "tool_name": call.name if call else "",
        "tool_city": call.input.get("city", "") if call else "",
        "tool_call_id": call.id if call else "",
    }


if __name__ == "__main__":
    import json

    print(json.dumps(run("fast")))
