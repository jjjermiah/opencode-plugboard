"""S6, structured output, LiteLLM as a client: a pydantic response_format. The Meal model forbids extra keys, so the
answer is validated by it; extra_keys is therefore empty by construction.
"""

from pydantic import BaseModel, ConfigDict

from chat import plugboard

PROMPT = "Estimate: 2 boiled eggs and a slice of toast."


class Meal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    calories: float
    protein_g: float


def run(model: str) -> dict:
    # region snippet
    response = plugboard(model, messages=[{"role": "user", "content": PROMPT}], response_format=Meal)
    meal = Meal.model_validate_json(response.choices[0].message.content or "")
    # endregion snippet
    return {"calories": meal.calories, "protein_g": meal.protein_g, "extra_keys": []}
