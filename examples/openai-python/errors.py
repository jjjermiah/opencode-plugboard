"""E1 wrong key (401 invalid_api_key) and E2 unknown model (404 model_not_found). The SDK raises; the observations are the error."""

import json
import os

import openai

FAKE_KEY = "sk-wrong-key-example"  # a fixed fake: it may appear in the run, the app key may not
PROMPT = "Reply with exactly: pong"


def run_wrong_key(client, model):
    # region snippet
    wrong = openai.OpenAI(base_url=str(client.base_url), api_key=FAKE_KEY, max_retries=0)
    try:
        wrong.chat.completions.create(model=model, messages=[{"role": "user", "content": PROMPT}])
    except openai.AuthenticationError as error:
        return {"status": error.status_code, "code": error.code}
    # endregion snippet
    raise AssertionError("a wrong key was accepted")


def run_unknown_model(client, model):
    # region snippet
    try:
        client.chat.completions.create(model=model, messages=[{"role": "user", "content": PROMPT}])
    except openai.NotFoundError as error:
        return {"status": error.status_code, "code": error.code}
    # endregion snippet
    raise AssertionError(f"model {model!r} was accepted")


if __name__ == "__main__":
    client = openai.OpenAI(base_url=os.environ["PLUGBOARD_BASE_URL"], api_key=os.environ["PLUGBOARD_KEY"], max_retries=0)
    print(json.dumps(run_wrong_key(client, "fast")))
    print(json.dumps(run_unknown_model(client, "nope")))
