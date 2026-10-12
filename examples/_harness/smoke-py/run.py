"""Runner for the Python smoke example: S1 on every model it covers. Started by examples/_harness/run.ts; writes nothing."""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "py"))

import harness  # noqa: E402
from chat import run as chat  # noqa: E402
from openai import OpenAI  # noqa: E402


def main() -> None:
    client = OpenAI(base_url=os.environ["PLUGBOARD_BASE_URL"], api_key=os.environ["PLUGBOARD_KEY"], max_retries=0)
    harness.emit_client("openai")
    harness.run_all({"S1": lambda model: chat(client, model)})


if __name__ == "__main__":
    main()
