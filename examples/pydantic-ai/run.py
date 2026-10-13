"""Runner for the pydantic-ai example. Started by examples/_harness/run.ts, which captures the traffic and writes
the run. This file writes nothing: it prints one JSON line per scenario and model.

    uv run --frozen run.py          # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness
"""

import asyncio
import os
import sys
from pathlib import Path
from typing import Any, Callable

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "_harness" / "py"))

import chat  # noqa: E402
import errors  # noqa: E402
import harness  # noqa: E402
import image  # noqa: E402
import models  # noqa: E402
import stream  # noqa: E402
import stream_tools  # noqa: E402
import structured  # noqa: E402
import tools  # noqa: E402
from openai import AsyncOpenAI  # noqa: E402


def scenario(function: Callable[..., Any]) -> Callable[[str], dict]:
    """Runs one async scenario on its own event loop, with a client that is closed inside that loop."""

    def call(model: str) -> dict:
        async def go() -> dict:
            client = AsyncOpenAI(base_url=os.environ["PLUGBOARD_BASE_URL"], api_key=os.environ["PLUGBOARD_KEY"], max_retries=0)
            try:
                return await function(client, model)
            finally:
                await client.close()

        return asyncio.run(go())

    return call


def main() -> None:
    harness.emit_client("pydantic-ai-slim")
    harness.run_all(
        {
            "S1": scenario(chat.run),
            "S2": scenario(tools.run),
            "S3": scenario(stream.run),
            "S4": scenario(stream_tools.run),
            "S5": scenario(image.run),
            "S6": scenario(structured.run),
            "S7": scenario(models.run),
            "E1": scenario(errors.run_wrong_key),
            "E2": scenario(errors.run_unknown_model),
        }
    )


if __name__ == "__main__":
    main()
