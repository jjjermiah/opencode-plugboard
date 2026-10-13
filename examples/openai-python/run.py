"""Runner for the OpenAI Python SDK example. Started by examples/_harness/run.ts, which captures the traffic and writes
the run. This file writes nothing: it prints one JSON line per scenario and model.

    uv run --frozen run.py          # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness
"""

import os
import sys
from pathlib import Path

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
from openai import OpenAI  # noqa: E402


def main() -> None:
    client = OpenAI(base_url=os.environ["PLUGBOARD_BASE_URL"], api_key=os.environ["PLUGBOARD_KEY"], max_retries=0)
    harness.emit_client("openai")
    harness.run_all(
        {
            "S1": lambda model: chat.run(client, model),
            "S2": lambda model: tools.run(client, model),
            "S3": lambda model: stream.run(client, model),
            "S4": lambda model: stream_tools.run(client, model),
            "S5": lambda model: image.run(client, model),
            "S6": lambda model: structured.run(client, model),
            "S7": lambda model: models.run(client, model),
            "E1": lambda model: wrong_key.run(client, model),
            "E2": lambda model: unknown_model.run(client, model),
        }
    )


if __name__ == "__main__":
    main()
