"""Shared scaffolding for the Python client harnesses (#221, #224, #225, #227).

A harness is a list of scenarios. Each scenario makes calls through its client and raises when the
answer is wrong. `main()` runs them, prints one JSON line per scenario and exits 1 if any failed:

    {"client": "instructor", "scenario": "structured", "status": "pass", "detail": "..."}

Environment (read here, never printed):
  PLUGBOARD_URL    server root, e.g. http://127.0.0.1:4010 (`/v1` is added when missing)
  PLUGBOARD_KEY    an app key of that server
  PLUGBOARD_MODEL  the model id to use (default `fast`)
"""

from __future__ import annotations

import json
import os
import sys
import traceback
from typing import Callable

MODEL = os.environ.get("PLUGBOARD_MODEL", "fast")
PONG_PROMPT = "Reply with exactly: pong"
WEATHER_PROMPT = "What is the weather in Paris? Use the tool."
WEATHER_PARAMS = {"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]}
WEATHER_RESULT = '{"temp_c": 18, "sky": "cloudy"}'

Scenario = tuple[str, Callable[[], "str | None"]]


def base_url() -> str:
    root = os.environ.get("PLUGBOARD_URL", "").rstrip("/")
    if not root:
        raise SystemExit("PLUGBOARD_URL is required (the server root, e.g. http://127.0.0.1:4010)")
    return root if root.endswith("/v1") else root + "/v1"


def api_key() -> str:
    key = os.environ.get("PLUGBOARD_KEY", "")
    if not key:
        raise SystemExit("PLUGBOARD_KEY is required (an app key of the plugboard server)")
    return key


def require(condition: object, message: str) -> None:
    """An explicit check: unlike `assert`, it still runs under `python -O`."""
    if not condition:
        raise AssertionError(message)


def redact(text: str, key: str) -> str:
    return text.replace(key, "<key>") if key else text


def main(client: str, scenarios: list[Scenario]) -> None:
    key = os.environ.get("PLUGBOARD_KEY", "")
    failed = 0
    for name, fn in scenarios:
        try:
            status, detail = "pass", fn() or ""
        except Exception as error:  # one scenario must not stop the others
            traceback.print_exc()
            status, detail = "fail", f"{type(error).__name__}: {error}"
            failed += 1
        print(json.dumps({"client": client, "scenario": name, "status": status, "detail": redact(detail, key)[:400]}), flush=True)
    sys.exit(1 if failed else 0)
