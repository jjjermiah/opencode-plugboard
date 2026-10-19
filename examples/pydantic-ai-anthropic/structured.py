"""S6, structured output. output_type is a Pydantic model: pydantic-ai asks the model for the fields through a tool and validates
the answer. On Messages that tool is pydantic-ai's output tool, not output_config.format (which plugboard refuses)."""

import asyncio
import json

from pydantic import BaseModel
from pydantic_ai import Agent
from pydantic_ai.messages import ModelResponse, ToolCallPart

from llm import chat_model, make_client

PROMPT = "Estimate: 2 boiled eggs and a slice of toast."


class Meal(BaseModel):
    calories: float
    protein_g: float


async def run(client, model):
    # region snippet
    agent = Agent(chat_model(client, model), output_type=Meal)
    result = await agent.run(PROMPT)
    meal = result.output  # a Meal, or pydantic-ai raises after its retries
    # endregion snippet
    # The raw answer, before validation: the fields the model sent beyond the Meal fields.
    last = [message for message in result.all_messages() if isinstance(message, ModelResponse)][-1]
    calls = [part for part in last.parts if isinstance(part, ToolCallPart)]
    raw = calls[0].args_as_dict() if calls else {}
    return {
        "calories": meal.calories,
        "protein_g": meal.protein_g,
        "extra_keys": sorted(set(raw) - {"calories", "protein_g"}),
    }


if __name__ == "__main__":
    print(json.dumps(asyncio.run(run(make_client(), "fast"))))
