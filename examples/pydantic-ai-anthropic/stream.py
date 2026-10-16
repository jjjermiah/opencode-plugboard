"""S3, streaming text. The text arrives in deltas; the run's usage is read once the stream ends."""

import asyncio
import dataclasses
import json

from pydantic_ai import Agent

from llm import chat_model, finish_reason, make_client


async def run(client, model):
    # region snippet
    agent = Agent(chat_model(client, model))
    async with agent.run_stream("Reply with exactly: pong") as stream:
        deltas = [text async for text in stream.stream_text(delta=True)]
    # endregion snippet
    return {
        "text": "".join(deltas),
        "finish_reason": finish_reason(stream.response.finish_reason),
        "usage": dataclasses.asdict(stream.usage),
        # pydantic-ai reads the stream to its end, through message_stop.
        "done": True,
    }


if __name__ == "__main__":
    print(json.dumps(asyncio.run(run(make_client(), "fast"))))
