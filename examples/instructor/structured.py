"""S6, structured output with Instructor: a validated Meal in three modes.

Instructor wraps the OpenAI client, so the plugboard base_url carries through. The snippets are the copyable part: each
one builds `client` (an Instructor client for one mode) and returns the parsed Meal. `plugboard()` (outside the snippets)
is the OpenAI client the runner passes in, built from PLUGBOARD_BASE_URL and PLUGBOARD_KEY.

The Meal model forbids extra keys, so an answer with any extra key fails validation. That is why `extra_keys` is always
empty here: the check is the model's own rule, not a count of keys in the raw answer.
"""

import os

import instructor
from openai import OpenAI
from pydantic import BaseModel, ConfigDict

PROMPT = "Estimate: 2 boiled eggs and a slice of toast."


class Meal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    calories: float
    protein_g: float


# region snippet-client
def plugboard() -> OpenAI:
    return OpenAI(base_url=os.environ["PLUGBOARD_BASE_URL"], api_key=os.environ["PLUGBOARD_KEY"], max_retries=0)


# endregion snippet-client


def observed(meal: Meal) -> dict:
    return {"calories": meal.calories, "protein_g": meal.protein_g, "extra_keys": []}


def run(model: str, variant: str) -> dict:
    if variant == "tools":
        # region snippet-tools
        client = instructor.from_openai(plugboard(), mode=instructor.Mode.TOOLS)
        meal = client.chat.completions.create(model=model, response_model=Meal, messages=[{"role": "user", "content": PROMPT}])
        # endregion snippet-tools
        return observed(meal)
    if variant == "json-schema":
        # region snippet-json-schema
        client = instructor.from_openai(plugboard(), mode=instructor.Mode.JSON_SCHEMA)
        meal = client.chat.completions.create(model=model, response_model=Meal, messages=[{"role": "user", "content": PROMPT}])
        # endregion snippet-json-schema
        return observed(meal)
    # region snippet-partial
    client = instructor.from_openai(plugboard(), mode=instructor.Mode.TOOLS)
    partials = list(client.chat.completions.create_partial(model=model, response_model=Meal, messages=[{"role": "user", "content": PROMPT}]))
    last = partials[-1]
    # endregion snippet-partial
    return observed(last)
