"""S7, list models. The Anthropic client under the provider lists GET /v1/models with x-api-key (#399 fixed it there)."""

import asyncio
import json

from anthropic import AsyncAnthropic

from llm import make_client


async def run(client: AsyncAnthropic, _model):
    # region snippet
    models = client.models.list(limit=100)
    # endregion snippet
    ids = [model.id async for model in models]  # every page
    return {
        "model_ids": ids,
        "has_fast": "fast" in ids,
        "has_claude": any(i.startswith("anthropic/claude") for i in ids),
        "has_gpt_low": any(i.endswith("#low") for i in ids),
    }


if __name__ == "__main__":
    print(json.dumps(asyncio.run(run(make_client(), "-"))))
