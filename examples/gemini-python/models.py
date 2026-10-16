"""S7, list models, and get one. Gemini names carry a `models/` prefix; the runner drops it so ids match the other examples."""

import os

from google import genai
from google.genai import types


def run(client):
    # region snippet
    ids = [(model.name or "").removeprefix("models/") for model in client.models.list()]
    one = client.models.get(model="fast")  # GET /v1beta/models/fast
    # endregion snippet
    return {
        "model_ids": ids,
        "has_fast": "fast" in ids,
        "has_claude": any(model_id.startswith("anthropic/claude") for model_id in ids),
        "has_gpt_low": any(model_id.endswith("#low") for model_id in ids),
        "retrieved_name": (one.name or "").removeprefix("models/"),
    }


if __name__ == "__main__":
    base_url = os.environ.get("PLUGBOARD_BASE_URL", "http://127.0.0.1:4010/v1").removesuffix("/v1")
    client = genai.Client(api_key=os.environ["PLUGBOARD_KEY"], http_options=types.HttpOptions(base_url=base_url))
    print(run(client))
