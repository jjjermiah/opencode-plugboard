"""S5, image. A red PNG goes as a BinaryContent part; pydantic-ai sends it as a data URL."""

import asyncio
import json
import os
from pathlib import Path

from openai import AsyncOpenAI
from pydantic_ai import Agent, BinaryContent
from pydantic_ai.models import ModelSettings
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

PNG = (Path(__file__).resolve().parents[1] / "_shared" / "red32.png").read_bytes()


async def run(client, model):
    # region snippet
    agent = Agent(OpenAIChatModel(model, provider=OpenAIProvider(openai_client=client), settings=ModelSettings(max_tokens=1024)))
    result = await agent.run(["What color is this image? One word.", BinaryContent(data=PNG, media_type="image/png")])
    # endregion snippet
    return {"text": result.output}


if __name__ == "__main__":
    client = AsyncOpenAI(base_url=os.environ["PLUGBOARD_BASE_URL"], api_key=os.environ["PLUGBOARD_KEY"], max_retries=0)
    print(json.dumps(asyncio.run(run(client, "fast"))))
