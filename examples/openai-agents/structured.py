"""S6, structured output through the OpenAI Agents SDK: output_type is a pydantic model. The Meal model forbids extra keys,
so extra_keys is empty by construction.
"""

from pydantic import BaseModel, ConfigDict

from agents import Agent, Runner

from chat import model_for

PROMPT = "Estimate: 2 boiled eggs and a slice of toast."


class Meal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    calories: float
    protein_g: float


def run(model: str, api: str) -> dict:
    # region snippet
    agent = Agent(name="meal", model=model_for(model, api), instructions="Estimate the meal.", output_type=Meal)
    meal = Runner.run_sync(agent, PROMPT).final_output
    # endregion snippet
    if not isinstance(meal, Meal):
        raise AssertionError(f"output is {type(meal).__name__}: {meal!r}")
    return {"calories": meal.calories, "protein_g": meal.protein_g, "extra_keys": []}
