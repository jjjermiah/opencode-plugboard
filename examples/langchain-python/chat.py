"""S1, plain chat, non-stream. `client` is `chat_model` from llm.py: it gives a ChatOpenAI for a model id."""

import json


def run(client, model):
    # region snippet
    message = client(model).invoke("Reply with exactly: pong")
    # endregion snippet
    return {
        "text": str(message.content),
        "finish_reason": message.response_metadata.get("finish_reason"),
        "usage": message.usage_metadata,
    }


if __name__ == "__main__":
    from llm import chat_model

    print(json.dumps(run(chat_model, "fast")))
