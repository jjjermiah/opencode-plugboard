"""E1 wrong key (401 invalid_api_key) and E2 unknown model (404 model_not_found). pydantic-ai raises ModelHTTPError; the observations are its status and error code."""

import asyncio
import json
import os

from openai import AsyncOpenAI
from pydantic_ai import Agent
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.models import ModelSettings
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

FAKE_KEY = "sk-wrong-key-example"  # a fixed fake: it may appear in the run, the app key may not
PROMPT = "Reply with exactly: pong"


def _error_observation(error: ModelHTTPError) -> dict:
    body = error.body if isinstance(error.body, dict) else {}
    return {"status": error.status_code, "code": body.get("code")}


async def run_wrong_key(client, model):
    # region snippet
    async with AsyncOpenAI(base_url=str(client.base_url), api_key=FAKE_KEY, max_retries=0) as wrong:
        agent = Agent(OpenAIChatModel(model, provider=OpenAIProvider(openai_client=wrong), settings=ModelSettings(max_tokens=1024)))
        try:
            await agent.run(PROMPT)
        except ModelHTTPError as error:
            return _error_observation(error)
    # endregion snippet
    raise AssertionError("a wrong key was accepted")


async def run_unknown_model(client, model):
    # region snippet
    agent = Agent(OpenAIChatModel(model, provider=OpenAIProvider(openai_client=client), settings=ModelSettings(max_tokens=1024)))
    try:
        await agent.run(PROMPT)
    except ModelHTTPError as error:
        return _error_observation(error)
    # endregion snippet
    raise AssertionError(f"model {model!r} was accepted")


if __name__ == "__main__":
    client = AsyncOpenAI(base_url=os.environ["PLUGBOARD_BASE_URL"], api_key=os.environ["PLUGBOARD_KEY"], max_retries=0)
    print(json.dumps(asyncio.run(run_wrong_key(client, "fast"))))
    print(json.dumps(asyncio.run(run_unknown_model(client, "nope"))))
