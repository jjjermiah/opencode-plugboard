"""S7, list models. The Anthropic SDK lists GET /v1/models; the first page holds plugboard's whole catalog."""

from provider import client


def run():
    # region snippet
    page = client.models.list(limit=100)
    # endregion snippet
    ids = [model.id for model in page.data]
    return {
        "model_ids": ids,
        "has_fast": "fast" in ids,
        "has_claude": any(id.startswith("anthropic/claude") for id in ids),
        "has_gpt_low": any(id.endswith("#low") for id in ids),
    }


if __name__ == "__main__":
    import json

    print(json.dumps(run()))
