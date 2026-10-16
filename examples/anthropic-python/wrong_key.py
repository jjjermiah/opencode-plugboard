"""E1, wrong key (401 authentication_error). The SDK raises APIStatusError; the observations are its status and the error type."""

import os

from anthropic import Anthropic, APIStatusError

PROMPT = "Reply with exactly: pong"
# A fixed fake key: it may appear in a run; the app key may not.
WRONG_KEY = "sk-wrong-key-example"


def run(model):
    # region snippet
    wrong = Anthropic(base_url=os.environ["PLUGBOARD_BASE_URL"].removesuffix("/v1"), api_key=WRONG_KEY, max_retries=0)
    try:
        wrong.messages.create(model=model, max_tokens=1024, messages=[{"role": "user", "content": PROMPT}])
    except APIStatusError as error:
        # Messages errors carry Anthropic's error.type; there is no error.code (see the gap in run.py).
        inner = error.body.get("error", {}) if isinstance(error.body, dict) else {}
        return {"status": error.status_code, "code": inner.get("code") or inner.get("type")}
    # endregion snippet
    raise RuntimeError("a wrong key was accepted")


if __name__ == "__main__":
    import json

    print(json.dumps(run("fast")))
