"""S6, structured output. output_type is a Pydantic model: pydantic-ai asks the model for the fields through a tool and validates the answer."""

import asyncio
import json
import os

from openai import AsyncOpenAI
from pydantic import BaseModel
from pydantic_ai import Agent
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models import ModelSettings
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

PROMPT = "Estimate: 2 boiled eggs and a slice of toast."


class Meal(BaseModel):
    calories: float
    protein_g: float


async def run(client, model):
    # region snippet
    agent = Agent(OpenAIChatModel(model, provider=OpenAIProvider(openai_client=client), settings=ModelSettings(max_tokens=1024)), output_type=Meal)
    result = await agent.run(PROMPT)
    meal = result.output  # a Meal, or pydantic-ai raises after its retries
    # endregion snippet
    # The raw answer, before validation: the fields the model sent beyond the Meal fields. The model may answer through
    # the output tool or as text, depending on the provider.
    last = [message for message in result.all_messages() if isinstance(message, ModelResponse)][-1]
    part = next(part for part in last.parts if isinstance(part, (ToolCallPart, TextPart)))
    raw = part.args_as_dict() if isinstance(part, ToolCallPart) else json.loads(part.content)
    return {
        "calories": meal.calories,
        "protein_g": meal.protein_g,
        "extra_keys": sorted(set(raw) - {"calories", "protein_g"}),
    }


if __name__ == "__main__":
    client = AsyncOpenAI(base_url=os.environ["PLUGBOARD_BASE_URL"], api_key=os.environ["PLUGBOARD_KEY"], max_retries=0)
    print(json.dumps(asyncio.run(run(client, "fast"))))
