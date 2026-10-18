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


# Chat Completions (`chat`) and the Responses API (`responses`) run side by side on the scenarios that have both.
APIS = ["chat", "responses"]
# previous_response_id continues a stored response (docs/responses.md, since 0.51.0).
PREVIOUS_ID = "responses-previous-id"


def by_api(chat_run, responses_run):
    """The run for a variant: `chat` is the Chat Completions call, `responses` the Responses one."""

    def run(model, variant):
        if variant == "chat":
            return chat_run(model)
        return responses_run(model)

    return run


def main() -> None:
    client = OpenAI(base_url=os.environ["PLUGBOARD_BASE_URL"], api_key=os.environ["PLUGBOARD_KEY"], max_retries=0)
    harness.emit_client("openai")

    def s2(model, variant):
        if variant == PREVIOUS_ID:
            return tools.run_responses_previous_id(client, model)
        if variant == "chat":
            return tools.run(client, model)
        return tools.run_responses(client, model)

    harness.run_all(
        {
            "S1": by_api(lambda model: chat.run(client, model), lambda model: chat.run_responses(client, model)),
            "S2": s2,
            "S3": by_api(lambda model: stream.run(client, model), lambda model: stream.run_responses(client, model)),
            "S4": lambda model: stream_tools.run(client, model),
            "S5": by_api(lambda model: image.run(client, model), lambda model: image.run_responses(client, model)),
            "S6": by_api(lambda model: structured.run(client, model), lambda model: structured.run_responses(client, model)),
            "S7": lambda model: models.run(client, model),
            "E1": lambda model: wrong_key.run(client, model),
            "E2": lambda model: unknown_model.run(client, model),
        },
        variants={"S1": APIS, "S2": [*APIS, PREVIOUS_ID], "S3": APIS, "S5": APIS, "S6": APIS},
    )


if __name__ == "__main__":
    main()
