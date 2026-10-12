"""S6, structured output: the typed helper with a pydantic model, the top-level helper, and the raw json_schema form."""

import json
import os
from pathlib import Path

from pydantic import BaseModel, ConfigDict

SCHEMA = json.loads((Path(__file__).resolve().parents[1] / "_shared" / "meal_estimate.json_schema.json").read_text())
PROMPT = "Estimate: 2 boiled eggs and a slice of toast."


class Meal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    calories: float
    protein_g: float


def run(client, model):
    messages = [{"role": "user", "content": PROMPT}]
    # region snippet
    parsed = client.beta.chat.completions.parse(model=model, messages=messages, response_format=Meal)
    meal = parsed.choices[0].message.parsed  # a Meal, or the SDK raises
    # endregion snippet
    if not isinstance(meal, Meal):
        raise AssertionError(f"parse did not give a Meal: {parsed.choices[0].message.content!r}")
    top = client.chat.completions.parse(model=model, messages=messages, response_format=Meal)
    if not isinstance(top.choices[0].message.parsed, Meal):
        raise AssertionError("top-level parse did not give a Meal")
    # region snippet
    raw = client.chat.completions.create(
        model=model,
        messages=messages,
        response_format={"type": "json_schema", "json_schema": SCHEMA},
    )
    # endregion snippet
    data = json.loads(raw.choices[0].message.content or "")
    return {
        "calories": data.get("calories"),
        "protein_g": data.get("protein_g"),
        "extra_keys": sorted(set(data) - {"calories", "protein_g"}),
    }


if __name__ == "__main__":
    from openai import OpenAI

    client = OpenAI(base_url=os.environ["PLUGBOARD_BASE_URL"], api_key=os.environ["PLUGBOARD_KEY"], max_retries=0)
    print(json.dumps(run(client, "fast")))
