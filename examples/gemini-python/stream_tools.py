"""S4, streaming tool call. Gemini sends each function call whole in one chunk, with its full args."""

import os

from google import genai
from google.genai import types


def run(client, model):
    # region snippet
    tools = [
        types.Tool(
            function_declarations=[
                types.FunctionDeclaration(
                    name="get_weather",
                    description="Current weather for a city",
                    parameters_json_schema={"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]},
                )
            ]
        )
    ]
    call = None
    finish = None
    for chunk in client.models.generate_content_stream(
        model=model,
        contents="What is the weather in Paris? Use the tool.",
        config=types.GenerateContentConfig(tools=tools, max_output_tokens=1024),
    ):
        if chunk.function_calls:
            call = chunk.function_calls[0]
        if chunk.candidates and chunk.candidates[0].finish_reason:
            finish = chunk.candidates[0].finish_reason.value.lower()
    # endregion snippet
    return {
        "finish_reason": "tool_calls" if call else finish,
        "tool_name": call.name if call else None,
        "tool_city": (call.args or {}).get("city", "") if call else "",
        "tool_call_id": call.id if call else None,
    }


if __name__ == "__main__":
    base_url = os.environ.get("PLUGBOARD_BASE_URL", "http://127.0.0.1:4010/v1").removesuffix("/v1")
    client = genai.Client(api_key=os.environ["PLUGBOARD_KEY"], http_options=types.HttpOptions(base_url=base_url))
    print(run(client, "fast"))
