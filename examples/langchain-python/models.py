"""S7, list models. LangChain has no list call of its own: the wrapped OpenAI client lists them."""

import json


def run(client, _model):
    # region snippet
    ids = [model.id for model in client("fast").root_client.models.list()]  # root_client is the openai.OpenAI inside
    # endregion snippet
    return {
        "model_ids": ids,
        "has_fast": "fast" in ids,
        "has_claude": any(i.startswith("anthropic/claude") for i in ids),
        "has_gpt_low": any(i.endswith("#low") for i in ids),
    }


if __name__ == "__main__":
    from llm import chat_model

    print(json.dumps(run(chat_model, "-")))
