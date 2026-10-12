"""S2, tool call and tool-result turn. The model asks for get_weather, the app answers, the model finishes."""

import json
import os
from pathlib import Path

SHARED = Path(__file__).resolve().parents[1] / "_shared"
TOOL = json.loads((SHARED / "get_weather.tool.json").read_text())
TOOL_RESULT = (SHARED / "get_weather.result.json").read_text().strip()
PROMPT = "What is the weather in Paris? Use the tool."


def run(client, model):
    messages = [{"role": "user", "content": PROMPT}]
    # region snippet
    first = client.chat.completions.create(model=model, messages=messages, tools=[TOOL])
    call = first.choices[0].message.tool_calls[0]
    # Send the assistant turn back as the SDK typed it, then the result under the same call id.
    messages.append(first.choices[0].message.model_dump(exclude_none=True))
    messages.append({"role": "tool", "tool_call_id": call.id, "content": TOOL_RESULT})
    second = client.chat.completions.create(model=model, messages=messages, tools=[TOOL])
    # endregion snippet
    return {
        "finish_reason": first.choices[0].finish_reason,
        "tool_name": call.function.name,
        "tool_city": json.loads(call.function.arguments).get("city", ""),
        "tool_call_id": call.id,
        "final_text": second.choices[0].message.content or "",
        "final_finish_reason": second.choices[0].finish_reason,
    }


if __name__ == "__main__":
    from openai import OpenAI

    client = OpenAI(base_url=os.environ["PLUGBOARD_BASE_URL"], api_key=os.environ["PLUGBOARD_KEY"], max_retries=0)
    print(json.dumps(run(client, "fast")))
