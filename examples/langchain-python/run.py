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
from llm import chat_model, responses_model  # noqa: E402

# Chat Completions (`chat`) and the Responses API (`responses`) run side by side on the scenarios that have both.
APIS = ["chat", "responses"]


def by_api(run):
    """The scenario on the client for its variant: `chat` is ChatOpenAI on Chat Completions, `responses` on /v1/responses."""

    def scenario(model, variant):
        return run(chat_model if variant == "chat" else responses_model, model)

    return scenario


def main() -> None:
    harness.emit_client("langchain-openai")
    harness.run_all(
        {
            "S1": by_api(chat.run),
            "S2": by_api(tools.run),
            "S3": by_api(stream.run),
            "S4": lambda model: stream_tools.run(chat_model, model),
            "S5": by_api(image.run),
            "S6": by_api(structured.run),
            "S7": lambda model: models.run(chat_model, model),
            "E1": lambda model: errors.run_wrong_key(chat_model, model),
            "E2": lambda model: errors.run_unknown_model(chat_model, model),
        },
        variants={"S1": APIS, "S2": APIS, "S3": APIS, "S5": APIS, "S6": APIS},
        # LangChain exposes no finish_reason on the Responses route; plugboard returns status "completed", and LangChain's
        # response_metadata has only the status. The finish_reason checks are left out of those rows (#104); the rest run.
        unobserved={
            "S1|responses": {"finish_reason is stop": "LangChain exposes no finish_reason on the Responses route (plugboard returns status completed)"},
            "S2|responses": {
                "turn 1 finish_reason is tool_calls": "LangChain exposes no finish_reason on the Responses route (plugboard returns status completed)",
                "turn 2 finish_reason is stop": "LangChain exposes no finish_reason on the Responses route (plugboard returns status completed)",
            },
            "S3|responses": {"finish_reason is stop": "LangChain exposes no finish_reason on the Responses route (plugboard returns status completed)"},
        },
    )


if __name__ == "__main__":
    main()
