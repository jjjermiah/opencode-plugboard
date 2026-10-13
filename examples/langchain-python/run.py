"""Runner for the LangChain Python example. Started by examples/_harness/run.ts, which captures the traffic and writes
the run. This file writes nothing: it prints one JSON line per scenario and model.

    uv run --frozen run.py          # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness
"""

import sys
from pathlib import Path

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
from llm import chat_model  # noqa: E402


def main() -> None:
    harness.emit_client("langchain-openai")
    harness.run_all(
        {
            "S1": lambda model: chat.run(chat_model, model),
            "S2": lambda model: tools.run(chat_model, model),
            "S3": lambda model: stream.run(chat_model, model),
            "S4": lambda model: stream_tools.run(chat_model, model),
            "S5": lambda model: image.run(chat_model, model),
            "S6": lambda model: structured.run(chat_model, model),
            "S7": lambda model: models.run(chat_model, model),
            "E1": lambda model: errors.run_wrong_key(chat_model, model),
            "E2": lambda model: errors.run_unknown_model(chat_model, model),
        }
    )


if __name__ == "__main__":
    main()
