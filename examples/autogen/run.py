"""Runner for the AutoGen example. Started by examples/_harness/run.ts, which captures the traffic and writes the run.
This file writes nothing: it prints one JSON line per scenario, model and route.

    uv run --frozen run.py          # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness

Each scenario runs on the Chat Completions route (`chat`, api_type openai) and the Messages route (`messages`, api_type anthropic).
"""

import sys
from contextlib import redirect_stdout
from pathlib import Path
from typing import Any, Callable

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "_harness" / "py"))

import chat  # noqa: E402
import harness  # noqa: E402
import stream  # noqa: E402
import tools  # noqa: E402

ROUTES = ["chat", "messages"]
NO_FINISH = "AutoGen returns the reply text, not the finish reason"
NO_USAGE = "AutoGen returns no usage for a streamed reply"


def quiet(function: Callable[..., dict]) -> Callable[..., dict]:
    """AutoGen prints its chat to stdout, where the runner prints its JSON lines. Send that print to stderr."""

    def call(*args: Any) -> dict:
        with redirect_stdout(sys.stderr):
            return function(*args)

    return call


def main() -> None:
    harness.emit_client("autogen")
    harness.run_all(
        {"S1": quiet(chat.run), "S2": quiet(tools.run), "S3": quiet(stream.run)},
        # S3 runs on the chat route only: the Anthropic client of AutoGen does not stream.
        variants={"S1": ROUTES, "S2": ROUTES, "S3": ["chat"]},
        unobserved={
            "S1": {"finish_reason is stop": NO_FINISH},
            "S2": {"turn 1 finish_reason is tool_calls": NO_FINISH, "turn 2 finish_reason is stop": NO_FINISH},
            "S3": {"finish_reason is stop": NO_FINISH, "usage chunk present when requested": NO_USAGE},
        },
    )


if __name__ == "__main__":
    main()
