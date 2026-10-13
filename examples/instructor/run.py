"""Runner for the Instructor example. Started by examples/_harness/run.ts, which captures the traffic and writes the run.
This file writes nothing: it prints one JSON line per scenario and model.

    uv run --frozen run.py          # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "_harness" / "py"))

import harness  # noqa: E402
import structured  # noqa: E402

NOT_IN_RECORD = "Instructor is a structured-output client: this scenario is not part of its record"


def main() -> None:
    harness.emit_client("instructor")
    harness.run_all(
        {"S6": structured.run},
        variants={"S6": ["tools", "json-schema", "partial"]},
        na={
            "S1": NOT_IN_RECORD,
            "S2": NOT_IN_RECORD,
            "S3": NOT_IN_RECORD,
            "S4": NOT_IN_RECORD,
            "S5": NOT_IN_RECORD,
            "S7": NOT_IN_RECORD,
            "E1": NOT_IN_RECORD,
            "E2": NOT_IN_RECORD,
        },
    )


if __name__ == "__main__":
    main()
