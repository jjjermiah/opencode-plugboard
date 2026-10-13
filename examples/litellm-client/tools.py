"""S2, tool call and tool-result turn, LiteLLM as a client. The model asks for get_weather, the app answers, the model finishes.

The snippet uses `plugboard(model, ...)` from chat.py: a litellm.completion call with the openai/ prefix.
"""

import json
from pathlib import Path

from chat import plugboard

SHARED = Path(__file__).resolve().parents[1] / "_shared"
TOOL = {
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Current weather for a city",
        "parameters": json.loads((SHARED / "get_weather.tool.json").read_text())["function"]["parameters"],
    },
}
TOOL_RESULT = (SHARED / "get_weather.result.json").read_text().strip()
PROMPT = "What is the weather in Paris? Use the tool."


def run(model: str) -> dict:
    messages = [{"role": "user", "content": PROMPT}]
    # region snippet
    first = plugboard(model, messages=messages, tools=[TOOL])
    message = first.choices[0].message
    call = message.tool_calls[0]
    # Send the assistant turn back as LiteLLM typed it, then the result under the same call id.
    messages += [message.model_dump(exclude_none=True), {"role": "tool", "tool_call_id": call.id, "content": TOOL_RESULT}]
    second = plugboard(model, messages=messages, tools=[TOOL])
    # endregion snippet
    args = json.loads(call.function.arguments)
    return {
        "finish_reason": first.choices[0].finish_reason,
        "tool_name": call.function.name,
        "tool_city": args.get("city", ""),
        "tool_call_id": call.id,
        "final_text": second.choices[0].message.content or "",
        "final_finish_reason": second.choices[0].finish_reason,
    }
