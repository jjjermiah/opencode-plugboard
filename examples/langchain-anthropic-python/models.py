"""S7, list models. LangChain has no model-list call, so this is a plain GET /v1/models with httpx. It sends the key as a
Bearer token: GET /v1/models does not read x-api-key (see the anthropic-python gap, #399)."""

import os

import httpx


def run():
    # region snippet
    response = httpx.get(f"{os.environ['PLUGBOARD_BASE_URL']}/models", headers={"authorization": f"Bearer {os.environ['PLUGBOARD_KEY']}"})
    # endregion snippet
    ids = [model["id"] for model in response.json()["data"]]
    return {
        "status": response.status_code,
        "model_ids": ids,
        "has_fast": "fast" in ids,
        "has_claude": any(id.startswith("anthropic/claude") for id in ids),
        "has_gpt_low": any(id.endswith("#low") for id in ids),
    }


if __name__ == "__main__":
    import json

    print(json.dumps(run()))
