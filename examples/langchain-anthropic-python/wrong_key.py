"""E1, wrong key (401 authentication_error). A ChatAnthropic built with a fixed fake key; the observations are the status and the error type."""

from anthropic import APIStatusError

from llm import chat_model

PROMPT = "Reply with exactly: pong"
# A fixed fake key: it may appear in a run; the app key may not.
WRONG_KEY = "sk-wrong-key-example"


def run(model):
    # region snippet
    try:
        chat_model(model, api_key=WRONG_KEY).invoke(PROMPT)
    except APIStatusError as error:
        # Messages errors carry Anthropic's error.type; there is no error.code (see unobserved in run.py).
        inner = error.body.get("error", {}) if isinstance(error.body, dict) else {}
        return {"status": error.status_code, "code": inner.get("code") or inner.get("type")}
    # endregion snippet
    raise RuntimeError("a wrong key was accepted")


if __name__ == "__main__":
    import json

    print(json.dumps(run("fast")))
