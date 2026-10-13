"""E1 wrong key (401 invalid_api_key) and E2 unknown model (404 model_not_found). The client raises; the observations are the error."""

import json

import openai

FAKE_KEY = "sk-wrong-key-example"  # a fixed fake: it may appear in the run, the app key may not
PROMPT = "Reply with exactly: pong"


def run_wrong_key(client, model):
    # region snippet
    try:
        client(model, api_key=FAKE_KEY).invoke(PROMPT)
    except openai.AuthenticationError as error:
        return {"status": error.status_code, "code": error.code}
    # endregion snippet
    raise AssertionError("a wrong key was accepted")


def run_unknown_model(client, _model):
    # region snippet
    try:
        client("nope").invoke(PROMPT)
    except openai.NotFoundError as error:
        return {"status": error.status_code, "code": error.code}
    # endregion snippet
    raise AssertionError("an unknown model was accepted")


if __name__ == "__main__":
    from llm import chat_model

    print(json.dumps(run_wrong_key(chat_model, "fast")))
    print(json.dumps(run_unknown_model(chat_model, "nope")))
