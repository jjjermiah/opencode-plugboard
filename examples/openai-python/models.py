"""S7, list models, and retrieve one. Each entry carries an extra `plugboard` object; the SDK keeps it in model_extra."""

import json
import os

FAST = "fast"


def run(client, _model):
    # region snippet
    ids = [model.id for model in client.models.list()]
    retrieved = client.models.retrieve(FAST)  # GET /v1/models/fast
    # endregion snippet
    return {
        "model_ids": ids,
        "has_fast": FAST in ids,
        "has_claude": any(i.startswith("anthropic/claude") for i in ids),
        "has_gpt_low": any(i.endswith("#low") for i in ids),
        "retrieved_id": retrieved.id,
    }


if __name__ == "__main__":
    from openai import OpenAI

    client = OpenAI(base_url=os.environ["PLUGBOARD_BASE_URL"], api_key=os.environ["PLUGBOARD_KEY"], max_retries=0)
    print(json.dumps(run(client, "-")))
