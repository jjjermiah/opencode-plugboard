"""S1, plain chat, non-stream. One agent run: one prompt, one answer."""

import asyncio
import dataclasses
import json
import os

from openai import AsyncOpenAI
from pydantic_ai import Agent
from pydantic_ai.models import ModelSettings
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider


async def run(client, model):
    # region snippet
    agent = Agent(OpenAIChatModel(model, provider=OpenAIProvider(openai_client=client), settings=ModelSettings(max_tokens=1024)))
    result = await agent.run("Reply with exactly: pong")
    # endregion snippet
    return {
        "text": result.output,
        "finish_reason": result.response.finish_reason,
        "usage": dataclasses.asdict(result.usage),
    }


if __name__ == "__main__":
    client = AsyncOpenAI(base_url=os.environ["PLUGBOARD_BASE_URL"], api_key=os.environ["PLUGBOARD_KEY"], max_retries=0)
    print(json.dumps(asyncio.run(run(client, "fast"))))
