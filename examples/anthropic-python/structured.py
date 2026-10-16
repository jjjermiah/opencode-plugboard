"""S6, structured output as a forced tool. The Messages API has no response_format here: a tool with a JSON schema and
tool_choice pinned to it makes the model return its arguments as the schema-shaped input."""

from provider import client

PROMPT = "Estimate: 2 boiled eggs and a slice of toast."
KEYS = ["calories", "protein_g"]


def run(model):
    # region snippet
    message = client.messages.create(
        model=model,
        max_tokens=1024,
        tools=[
            {
                "name": "record_meal",
                "description": "Record the estimated nutrition for a meal",
                "input_schema": {
                    "type": "object",
                    "properties": {"calories": {"type": "number"}, "protein_g": {"type": "number"}},
                    "required": KEYS,
                    "additionalProperties": False,
                },
            }
        ],
        tool_choice={"type": "tool", "name": "record_meal"},
        messages=[{"role": "user", "content": PROMPT}],
    )
    # endregion snippet
    call = next((block for block in message.content if block.type == "tool_use"), None)
    arguments = dict(call.input) if call else {}
    return {
        "calories": arguments.get("calories"),
        "protein_g": arguments.get("protein_g"),
        "extra_keys": [key for key in arguments if key not in KEYS],
    }


if __name__ == "__main__":
    import json

    print(json.dumps(run("fast")))
