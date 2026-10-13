"""S4, streaming tool call. The name and id arrive in one chunk, the arguments in pieces; the `+` fold joins them."""

import json
import operator
from functools import reduce
from pathlib import Path

PROMPT = "What is the weather in Paris? Use the tool."
TOOL_RESULT = (Path(__file__).resolve().parents[1] / "_shared" / "get_weather.result.json").read_text().strip()


def run(client, model):
    # region snippet
    from langchain_core.tools import tool

    @tool
    def get_weather(city: str) -> str:
        """Current weather for a city."""
        return TOOL_RESULT

    llm = client(model, stream_usage=True).bind_tools([get_weather])
    chunks = list(llm.stream(PROMPT))
    full = reduce(operator.add, chunks)
    call = full.tool_calls[0]  # the arguments are parsed once the chunks are joined
    # endregion snippet
    return {
        "finish_reason": full.response_metadata.get("finish_reason"),
        "tool_name": call["name"],
        "tool_city": call["args"].get("city", ""),
        "tool_call_id": call["id"],
    }


if __name__ == "__main__":
    from llm import chat_model

    print(json.dumps(run(chat_model, "fast")))
