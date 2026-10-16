"""S6, structured output: a Pydantic model as the answer shape. json_schema is the checked form; the other two methods are recorded."""

import json

from pydantic import BaseModel, ConfigDict

PROMPT = "Estimate: 2 boiled eggs and a slice of toast."


class Meal(BaseModel):
    """Meal nutrition estimate."""

    model_config = ConfigDict(extra="forbid")
    calories: float
    protein_g: float


def _attempt(call):
    """What a method gave, or the error it raised. Recorded, not checked: see the README."""
    try:
        return {"ok": True, "result": call().model_dump()}
    except Exception as error:  # noqa: BLE001 - the error text is the record
        return {"ok": False, "error": f"{type(error).__name__}: {str(error)[:200]}"}


def _text(content):
    """A message's text. Chat Completions gives a string; the Responses path gives a list of content blocks."""
    if isinstance(content, str):
        return content
    return "".join(block.get("text", "") for block in content if isinstance(block, dict))


def run(client, model):
    # region snippet
    result = client(model).with_structured_output(Meal, method="json_schema", include_raw=True).invoke(PROMPT)
    # endregion snippet
    meal = result["parsed"]
    if not isinstance(meal, Meal):
        raise AssertionError(f"parse did not give a Meal: {result['parsing_error']!r}")
    data = json.loads(_text(result["raw"].content))  # the raw JSON, so extra keys would show
    function_calling = _attempt(lambda: client(model).with_structured_output(Meal, method="function_calling").invoke(PROMPT))
    json_mode = _attempt(
        lambda: client(model).with_structured_output(Meal, method="json_mode").invoke(PROMPT + " Respond as JSON with keys calories and protein_g (numbers).")
    )
    return {
        "calories": data.get("calories"),
        "protein_g": data.get("protein_g"),
        "extra_keys": sorted(set(data) - {"calories", "protein_g"}),
        "function_calling": function_calling,
        "json_mode": json_mode,
    }


if __name__ == "__main__":
    from llm import chat_model

    print(json.dumps(run(chat_model, "fast")))
