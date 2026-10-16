"""E1, wrong key (401 invalid_api_key). The SDK raises; the observation is the error."""

import json
import os

import openai

FAKE_KEY = "sk-wrong-key-example"  # a fixed fake: it may appear in the run, the app key may not
PROMPT = "Reply with exactly: pong"


def run(client, model):
    # region snippet
    wrong = openai.OpenAI(base_url=str(client.base_url), api_key=FAKE_KEY, max_retries=0)
    try:
        wrong.chat.completions.create(model=model, messages=[{"role": "user", "content": PROMPT}])
    except openai.AuthenticationError as error:
        return {"status": error.status_code, "code": error.code, "type": error.type}
    # endregion snippet
    raise AssertionError("a wrong key was accepted")


if __name__ == "__main__":
    client = openai.OpenAI(base_url=os.environ["PLUGBOARD_BASE_URL"], api_key=os.environ["PLUGBOARD_KEY"], max_retries=0)
    print(json.dumps(run(client, "fast")))
