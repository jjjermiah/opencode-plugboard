"""S7, list models. pydantic-ai has no model-listing call; the OpenAI client under its provider does."""

import asyncio
import json
import os

from openai import AsyncOpenAI
from pydantic_ai.providers.openai import OpenAIProvider


async def run(client, _model):
    # region snippet
    provider = OpenAIProvider(openai_client=client)
    page = await provider.client.models.list()
    ids = [model.id for model in page.data]
    # endregion snippet
    return {
        "model_ids": ids,
        "has_fast": "fast" in ids,
        "has_claude": any(i.startswith("anthropic/claude") for i in ids),
        "has_gpt_low": any(i.endswith("#low") for i in ids),
    }


if __name__ == "__main__":
    client = AsyncOpenAI(base_url=os.environ["PLUGBOARD_BASE_URL"], api_key=os.environ["PLUGBOARD_KEY"], max_retries=0)
    print(json.dumps(asyncio.run(run(client, "-"))))
