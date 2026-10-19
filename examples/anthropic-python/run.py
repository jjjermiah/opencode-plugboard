"""Runner for the Anthropic Python SDK example. Started by examples/_harness/run.ts, which captures the traffic and writes
the run. This file writes nothing: it prints one JSON line per scenario and model.

    uv run --frozen run.py          # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness
"""

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


def main() -> None:
    harness.emit_client("anthropic")
    harness.run_all(
        {
            "S1": chat.run,
            "S2": tools.run,
            "S3": stream.run,
            "S4": stream_tools.run,
            "S5": image.run,
            "S6": structured.run,
            "S7": lambda model: models.run(),
            "E1": wrong_key.run,
            "E2": lambda model: unknown_model.run(),
        },
        # The error code is not on the Messages wire (src/anthropic/response.ts:112), so the shared code checks are not observed.
        # The status checks stay enforced.
        unobserved={
            "E1": {"code is invalid_api_key": "Messages errors carry error.type and no error.code (src/anthropic/response.ts:112)"},
            "E2": {"code is model_not_found": "Messages errors carry error.type and no error.code (src/anthropic/response.ts:112)"},
        },
    )


if __name__ == "__main__":
    main()
