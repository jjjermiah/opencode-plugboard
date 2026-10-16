"""Runner for the Google GenAI Python SDK example. Started by examples/_harness/run.ts, which captures the traffic and writes
the run. This file writes nothing: it prints one JSON line per scenario and model.

    uv run --frozen run.py          # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness
"""

import os
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
from google import genai  # noqa: E402
from google.genai import types  # noqa: E402

# The SDK adds /v1beta itself, so the base URL is the plugboard origin, not the /v1 the other examples take.
BASE_URL = os.environ["PLUGBOARD_BASE_URL"].removesuffix("/v1")
CALL_ID = "Gemini function calls carry no id (Google's API); the call is paired with its result by name, so there is nothing to check"


def wire(model: str) -> str:
    """The SDK builds the URL, and a bare # starts a fragment, so the variant goes as %23 (docs/gemini.md, Model names)."""
    return model.replace("#", "%23")


def main() -> None:
    client = genai.Client(api_key=os.environ["PLUGBOARD_KEY"], http_options=types.HttpOptions(base_url=BASE_URL))
    harness.emit_client("google-genai")
    harness.run_all(
        {
            "S1": lambda model: chat.run(client, wire(model)),
            "S2": lambda model: tools.run(client, wire(model)),
            "S3": lambda model: stream.run(client, wire(model)),
            "S4": lambda model: stream_tools.run(client, wire(model)),
            "S5": lambda model: image.run(client, wire(model)),
            "S6": lambda model: structured.run(client, wire(model)),
            "S7": lambda model: models.run(client),
            "E1": lambda model: errors.run_wrong_key(BASE_URL, wire(model)),
            "E2": lambda model: errors.run_unknown_model(client, wire(model)),
        },
        gaps={
            "S5": {
                "note": "the Python SDK sends inlineData as mime_type, which plugboard rejects with 400 INVALID_ARGUMENT",
                "issue": "#401",
            }
        },
        unobserved={
            "S2": {"call id present": CALL_ID},
            "S4": {"call id present": CALL_ID},
            "E1": {"code is invalid_api_key": "Google's error body names the status UNAUTHENTICATED, not invalid_api_key; the status 401 is checked"},
            "E2": {"code is model_not_found": "Google's error body names the status NOT_FOUND, not model_not_found; the status 404 is checked"},
        },
    )


if __name__ == "__main__":
    main()
