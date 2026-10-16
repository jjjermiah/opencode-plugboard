"""Runner for the pydantic-ai Anthropic example. Started by examples/_harness/run.ts, which captures the traffic and writes the run.
This file writes nothing: it prints one JSON line per scenario and model.

    uv run --frozen run.py          # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness
"""

import asyncio
import sys
from pathlib import Path
from typing import Any, Callable

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "_harness" / "py"))

import chat  # noqa: E402
import harness  # noqa: E402
import image  # noqa: E402
import models  # noqa: E402
import stream  # noqa: E402
import stream_tools  # noqa: E402
import structured  # noqa: E402
import tools  # noqa: E402
import unknown_model  # noqa: E402
import wrong_key  # noqa: E402
from llm import make_client  # noqa: E402


def scenario(function: Callable[..., Any]) -> Callable[[str], dict]:
    """Runs one async scenario on its own event loop, with a client that is closed inside that loop."""

    def call(model: str) -> dict:
        async def go() -> dict:
            client = make_client()
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
            "E1": scenario(wrong_key.run),
            "E2": scenario(unknown_model.run),
        },
        unobserved={
            # The error code is not on the Messages wire (src/anthropic/response.ts:112), so the shared code checks are not observed.
            "E1": {"code is invalid_api_key": "Messages errors carry error.type and no error.code (src/anthropic/response.ts:112)"},
            "E2": {"code is model_not_found": "Messages errors carry error.type and no error.code (src/anthropic/response.ts:112)"},
        },
        gaps={
            # The SDK's models.list sends x-api-key, which GET /v1/models refuses (#399).
            "S7": {"note": "GET /v1/models ignores x-api-key, which the SDK sends", "issue": "#399"},
        },
    )


if __name__ == "__main__":
    main()
