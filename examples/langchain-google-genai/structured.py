"""S6, structured output: a pydantic schema through with_structured_output, the answer read back as typed fields."""

import json

from pydantic import BaseModel
from langchain_core.messages import HumanMessage


class Meal(BaseModel):
    calories: float
    protein_g: float


def run(client, model):
    # region snippet
    llm = client(model).with_structured_output(Meal)
    meal = llm.invoke([HumanMessage("Estimate: 2 boiled eggs and a slice of toast.")])
    # endregion snippet
    return {
        "calories": meal.calories,
        "protein_g": meal.protein_g,
        "extra_keys": [],  # the pydantic model holds exactly the two fields
    }


if __name__ == "__main__":
    from llm import chat_model

    print(json.dumps(run(chat_model, "fast")))
