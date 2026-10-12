"""S4, streaming tool call. The name and id come in one delta, the arguments in one or more; accumulate them."""

import json
import os
from pathlib import Path

SHARED = Path(__file__).resolve().parents[1] / "_shared"
TOOL = json.loads((SHARED / "get_weather.tool.json").read_text())
PROMPT = "What is the weather in Paris? Use the tool."


def run(client, model):
    # region snippet
    stream = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": PROMPT}],
        tools=[TOOL],
        stream=True,
        stream_options={"include_usage": True},
    )
    deltas, finish = [], None
    for chunk in stream:
        for choice in chunk.choices:
            deltas.extend(choice.delta.tool_calls or [])
            finish = choice.finish_reason or finish
    # endregion snippet
    named = next(d for d in deltas if d.function and d.function.name)
    arguments = "".join(d.function.arguments or "" for d in deltas if d.function)
    return {
        "finish_reason": finish,
        "tool_name": named.function.name,
        "tool_city": json.loads(arguments).get("city", ""),
        "tool_call_id": next((d.id for d in deltas if d.id), ""),
    }


if __name__ == "__main__":
    from openai import OpenAI

    client = OpenAI(base_url=os.environ["PLUGBOARD_BASE_URL"], api_key=os.environ["PLUGBOARD_KEY"], max_retries=0)
    print(json.dumps(run(client, "fast")))
