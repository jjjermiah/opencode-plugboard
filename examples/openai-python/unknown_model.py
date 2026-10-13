"""E2, unknown model (404 model_not_found). The SDK raises; the observation is the error."""

import json
import os

import openai

PROMPT = "Reply with exactly: pong"


def run(client, model):
    # region snippet
    try:
        client.chat.completions.create(model=model, messages=[{"role": "user", "content": PROMPT}])
    except openai.NotFoundError as error:
        return {"status": error.status_code, "code": error.code}
    # endregion snippet
    raise AssertionError(f"model {model!r} was accepted")


if __name__ == "__main__":
    client = openai.OpenAI(base_url=os.environ["PLUGBOARD_BASE_URL"], api_key=os.environ["PLUGBOARD_KEY"], max_retries=0)
    print(json.dumps(run(client, "nope")))
