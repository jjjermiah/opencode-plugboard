"""Runner for the LangChain Google GenAI example. Started by examples/_harness/run.ts, which captures the traffic and writes
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
import stream  # noqa: E402
import stream_tools  # noqa: E402
import structured  # noqa: E402
import tools  # noqa: E402
from llm import chat_model  # noqa: E402

CALL_ID = "Gemini function calls carry no id (Google's API); LangChain generates one locally, so the id is not a plugboard check"
NO_LIST = "LangChain's Google chat model does not list models; GET /v1beta/models is not part of it"


def main() -> None:
    harness.emit_client("langchain-google-genai")
    harness.run_all(
        {
            "S1": lambda model: chat.run(chat_model, model),
            "S2": lambda model: tools.run(chat_model, model),
            "S3": lambda model: stream.run(chat_model, model),
            "S4": lambda model: stream_tools.run(chat_model, model),
            "S5": lambda model: image.run(chat_model, model),
            "S6": lambda model: structured.run(chat_model, model),
            "E1": lambda model: errors.run_wrong_key(chat_model, model),
            "E2": lambda model: errors.run_unknown_model(chat_model, model),
        },
        na={"S7": NO_LIST},
        gaps={
            "S5": {
                "note": "LangChain sends inlineData as mime_type, which plugboard rejects with 400 INVALID_ARGUMENT",
                "issue": "#401",
            }
        },
        unobserved={
            "E1": {"code is invalid_api_key": "Google's error body names the status UNAUTHENTICATED, not invalid_api_key; the status 401 is checked"},
            "E2": {"code is model_not_found": "Google's error body names the status NOT_FOUND, not model_not_found; the status 404 is checked"},
        },
    )


if __name__ == "__main__":
    main()
