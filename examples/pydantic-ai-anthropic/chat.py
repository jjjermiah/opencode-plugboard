"""S1, plain chat, non-stream. One agent run: one prompt, one answer."""

import asyncio
import dataclasses
import json

from pydantic_ai import Agent

from llm import chat_model, finish_reason, make_client


async def run(client, model):
    # region snippet
    agent = Agent(chat_model(client, model))
    result = await agent.run("Reply with exactly: pong")
    # endregion snippet
    return {
        "text": result.output,
        "finish_reason": finish_reason(result.response.finish_reason),
        "usage": dataclasses.asdict(result.usage),
    }


if __name__ == "__main__":
    print(json.dumps(asyncio.run(run(make_client(), "fast"))))
