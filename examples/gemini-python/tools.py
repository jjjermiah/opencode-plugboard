"""S2, tool call and tool-result turn. The model asks for get_weather, the app answers, the model finishes."""

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
    config = types.GenerateContentConfig(tools=tools, max_output_tokens=1024)
    contents = [types.Content(role="user", parts=[types.Part(text="What is the weather in Paris? Use the tool.")])]
    first = client.models.generate_content(model=model, contents=contents, config=config)
    call = first.function_calls[0] if first.function_calls else None
    # Send the model's turn back as it came, then the result as a functionResponse. Gemini calls carry no id: the name pairs them.
    turn = list(contents)
    if first.candidates and first.candidates[0].content:
        turn.append(first.candidates[0].content)
    if call:
        turn.append(types.Content(role="user", parts=[types.Part.from_function_response(name=call.name, response={"temp_c": 18, "sky": "cloudy"})]))
    second = client.models.generate_content(model=model, contents=turn, config=config)
    # endregion snippet
    reason = second.candidates[0].finish_reason if second.candidates else None
    first_reason = first.candidates[0].finish_reason if first.candidates else None
    return {
        # Gemini reports STOP on a function call too; a turn that holds a call is read as tool_calls.
        "finish_reason": "tool_calls" if call else (first_reason.value.lower() if first_reason else None),
        "tool_name": call.name if call else None,
        "tool_city": (call.args or {}).get("city", "") if call else "",
        "tool_call_id": call.id if call else None,
        "final_text": second.text or "",
        "final_finish_reason": reason.value.lower() if reason else None,
    }


if __name__ == "__main__":
    base_url = os.environ.get("PLUGBOARD_BASE_URL", "http://127.0.0.1:4010/v1").removesuffix("/v1")
    client = genai.Client(api_key=os.environ["PLUGBOARD_KEY"], http_options=types.HttpOptions(base_url=base_url))
    print(run(client, "fast"))
