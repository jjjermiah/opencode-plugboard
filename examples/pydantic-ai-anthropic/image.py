"""S5, image. A red PNG goes as a BinaryContent part; pydantic-ai sends it as a base64 image block."""

import asyncio
import json
from pathlib import Path

from pydantic_ai import Agent, BinaryContent

from llm import chat_model, make_client

PNG = (Path(__file__).resolve().parents[1] / "_shared" / "red32.png").read_bytes()


async def run(client, model):
    # region snippet
    agent = Agent(chat_model(client, model))
    result = await agent.run(["What color is this image? One word.", BinaryContent(data=PNG, media_type="image/png")])
    # endregion snippet
    return {"text": result.output}


if __name__ == "__main__":
    print(json.dumps(asyncio.run(run(make_client(), "fast"))))
