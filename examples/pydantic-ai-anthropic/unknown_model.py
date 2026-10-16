"""E2, unknown model (404 not_found_error). pydantic-ai raises ModelHTTPError; the observations are its status and the error type."""

import asyncio
import json

from pydantic_ai import Agent
from pydantic_ai.exceptions import ModelHTTPError

from llm import chat_model, make_client

PROMPT = "Reply with exactly: pong"


async def run(client, model):
    # region snippet
    try:
        await Agent(chat_model(client, model)).run(PROMPT)
    except ModelHTTPError as error:
        body = error.body if isinstance(error.body, dict) else {}
        inner = body.get("error", {}) if isinstance(body.get("error"), dict) else {}
        return {"status": error.status_code, "code": inner.get("type"), "type": inner.get("type")}
    # endregion snippet
    raise AssertionError(f"model {model!r} was accepted")


if __name__ == "__main__":
    print(json.dumps(asyncio.run(run(make_client(), "nope"))))
