"""Runner for the LiteLLM example. Started by examples/_harness/run.ts, which captures the traffic and writes the run.
This file writes nothing: it prints one JSON line per scenario and model.

    uv run --frozen run.py          # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "_harness" / "py"))

import chat  # noqa: E402
import harness  # noqa: E402
import structured  # noqa: E402
import tools  # noqa: E402

NOT_IN_RECORD = "not part of the 2026-10-12 LiteLLM record (text, stream, tool round trip, structured output)"


def main() -> None:
    harness.emit_client("litellm")
    harness.run_all(
        {"S1": chat.run, "S2": tools.run, "S3": chat.stream, "S6": structured.run},
        na={
            "S4": NOT_IN_RECORD,
            "S5": NOT_IN_RECORD,
            "S7": NOT_IN_RECORD,
            "E1": NOT_IN_RECORD,
            "E2": NOT_IN_RECORD,
        },
    )


if __name__ == "__main__":
    main()
