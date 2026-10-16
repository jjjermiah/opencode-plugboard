"""E2, unknown model (404 not_found_error). The SDK raises APIStatusError; the observations are its status and the error type."""

from anthropic import APIStatusError

from provider import client

PROMPT = "Reply with exactly: pong"


def run():
    # region snippet
    try:
        client.messages.create(model="nope", max_tokens=1024, messages=[{"role": "user", "content": PROMPT}])
    except APIStatusError as error:
        # Messages errors carry Anthropic's error.type; there is no error.code (see unobserved in run.py).
        inner = error.body.get("error", {}) if isinstance(error.body, dict) else {}
        return {"status": error.status_code, "code": inner.get("code") or inner.get("type"), "type": inner.get("type")}
    # endregion snippet
    raise RuntimeError("an unknown model was accepted")


if __name__ == "__main__":
    import json

    print(json.dumps(run()))
