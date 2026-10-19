"""S2, tool call and tool-result turn. The model asks for get_weather, the app answers, the model finishes."""

import json
import os
from pathlib import Path

from chat import responses_finish_reason

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


# The Responses API takes the function flat: no `function` wrapper, and the name at the top level.
RESPONSES_TOOL = {"type": "function", **TOOL["function"]}


def _responses_observations(first, second, call):
    return {
        "finish_reason": responses_finish_reason(first),
        "tool_name": call.name,
        "tool_city": json.loads(call.arguments).get("city", ""),
        "tool_call_id": call.call_id,
        "final_text": second.output_text,
        "final_finish_reason": responses_finish_reason(second),
    }


def run_responses(client, model):
    # region snippet-responses
    first = client.responses.create(model=model, input=PROMPT, tools=[RESPONSES_TOOL], store=False, max_output_tokens=1024)
    call = next(item for item in first.output if item.type == "function_call")
    # Store is off, so the whole conversation goes back in input: the answer's items as the SDK typed them, then the result.
    items = [{"role": "user", "content": PROMPT}, *(item.model_dump(exclude_none=True) for item in first.output)]
    items.append({"type": "function_call_output", "call_id": call.call_id, "output": TOOL_RESULT})
    second = client.responses.create(model=model, input=items, tools=[RESPONSES_TOOL], store=False, max_output_tokens=1024)
    # endregion snippet-responses
    return _responses_observations(first, second, call)


def run_responses_previous_id(client, model):
    """The same round trip with previous_response_id in place of the replayed history. Plugboard keeps the first answer (store is on by default) and continues from it."""
    first = client.responses.create(model=model, input=PROMPT, tools=[RESPONSES_TOOL], max_output_tokens=1024)
    call = next(item for item in first.output if item.type == "function_call")
    second = client.responses.create(
        model=model,
        previous_response_id=first.id,
        input=[{"type": "function_call_output", "call_id": call.call_id, "output": TOOL_RESULT}],
        tools=[RESPONSES_TOOL],
        max_output_tokens=1024,
    )
    return _responses_observations(first, second, call)


if __name__ == "__main__":
    from openai import OpenAI

    client = OpenAI(base_url=os.environ["PLUGBOARD_BASE_URL"], api_key=os.environ["PLUGBOARD_KEY"], max_retries=0)
    print(json.dumps(run(client, "fast")))
