"""S3, streaming text, with usage. The text arrives in deltas; the run's usage is read once the stream ends."""

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
    async with agent.run_stream("Reply with exactly: pong") as stream:
        deltas = [text async for text in stream.stream_text(delta=True)]
    # endregion snippet
    return {
        "text": "".join(deltas),
        "finish_reason": stream.response.finish_reason,
        "usage": dataclasses.asdict(stream.usage),
        # pydantic-ai reads the stream to its end; the SDK consumes the [DONE] frame, which the transcript keeps
        "done": True,
    }


if __name__ == "__main__":
    client = AsyncOpenAI(base_url=os.environ["PLUGBOARD_BASE_URL"], api_key=os.environ["PLUGBOARD_KEY"], max_retries=0)
    print(json.dumps(asyncio.run(run(client, "fast"))))
