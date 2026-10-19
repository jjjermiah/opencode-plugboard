"""S6, structured output through with_structured_output. ChatAnthropic answers it with a forced tool, not output_config.format."""

from pydantic import BaseModel

from llm import chat_model

PROMPT = "Estimate: 2 boiled eggs and a slice of toast."
KEYS = ["calories", "protein_g"]


class Meal(BaseModel):
    calories: float
    protein_g: float


def run(model):
    # region snippet
    output = chat_model(model).with_structured_output(Meal, method="function_calling").invoke(PROMPT)
    # endregion snippet
    data = output.model_dump()
    return {
        "calories": data["calories"],
        "protein_g": data["protein_g"],
        "extra_keys": [key for key in data if key not in KEYS],
    }


if __name__ == "__main__":
    import json

    print(json.dumps(run("fast")))
