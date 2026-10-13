"""S6, structured output through DSPy: an OutputField typed with a pydantic model. DSPy asks the model for the fields
through its own format, and the Meal model forbids extra keys, so extra_keys is empty by construction.
"""

from pydantic import BaseModel, ConfigDict

from chat import lm_for

import dspy

PROMPT = "Estimate: 2 boiled eggs and a slice of toast."


class Meal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    calories: float
    protein_g: float


def run(model: str) -> dict:
    dspy.configure(lm=lm_for(model))
    # region snippet
    class Estimate(dspy.Signature):
        """Estimate the meal's nutrition."""

        question: str = dspy.InputField()
        answer: Meal = dspy.OutputField()

    out = dspy.Predict(Estimate)(question=PROMPT)
    # endregion snippet
    meal = out.answer
    if not isinstance(meal, Meal):
        raise AssertionError(f"answer is {type(meal).__name__}: {meal!r}")
    return {"calories": meal.calories, "protein_g": meal.protein_g, "extra_keys": []}
