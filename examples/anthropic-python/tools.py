"""S2, tool call and tool-result turn. The Messages API returns the tool_use block; your code runs the tool and sends the
tool_result back. Plugboard only returns the call."""

import json
from pathlib import Path

from provider import client, finish_reason

PROMPT = "What is the weather in Paris? Use the tool."
WEATHER = json.loads((Path(__file__).resolve().parents[1] / "_shared" / "get_weather.result.json").read_text())
TOOLS = [
    {
        "name": "get_weather",
        "description": "Current weather for a city",
        "input_schema": {"type": "object", "properties": {"city": {"type": "string", "description": "City name"}}, "required": ["city"]},
    }
]


def run(model):
    messages = [{"role": "user", "content": PROMPT}]
    # region snippet
    first = client.messages.create(model=model, max_tokens=1024, tools=TOOLS, messages=messages)
    call = next(block for block in first.content if block.type == "tool_use")
    second = client.messages.create(
        model=model,
        max_tokens=1024,
        tools=TOOLS,
        messages=[
            *messages,
            {"role": "assistant", "content": first.content},
            {"role": "user", "content": [{"type": "tool_result", "tool_use_id": call.id, "content": json.dumps(WEATHER)}]},
        ],
    )
    # endregion snippet
    return {
        "finish_reason": finish_reason(first.stop_reason),
        "tool_name": call.name,
        "tool_city": call.input.get("city", ""),
        "tool_call_id": call.id,
        "final_text": "".join(block.text for block in second.content if block.type == "text"),
        "final_finish_reason": finish_reason(second.stop_reason),
    }


if __name__ == "__main__":
    print(json.dumps(run("fast")))
