"""E1, wrong key (401 authentication_error). pydantic-ai raises ModelHTTPError; the observations are its status and the error type.
Messages errors carry error.type and no error.code (src/anthropic/response.ts:112), so run.py does not check a code."""

import asyncio
import json

from pydantic_ai import Agent
from pydantic_ai.exceptions import ModelHTTPError

from llm import chat_model, make_client

FAKE_KEY = "sk-wrong-key-example"  # a fixed fake: it may appear in the run, the app key may not
PROMPT = "Reply with exactly: pong"


async def run(client, model):
    # region snippet
    wrong = make_client(api_key=FAKE_KEY)
    try:
        await Agent(chat_model(wrong, model)).run(PROMPT)
    except ModelHTTPError as error:
        body = error.body if isinstance(error.body, dict) else {}
        inner = body.get("error", {}) if isinstance(body.get("error"), dict) else {}
        return {"status": error.status_code, "code": inner.get("type")}
    finally:
        await wrong.close()
    # endregion snippet
    raise AssertionError("a wrong key was accepted")


if __name__ == "__main__":
    print(json.dumps(asyncio.run(run(make_client(), "fast"))))
