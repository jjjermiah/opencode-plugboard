"""S1, plain chat, non-stream. The smallest call: one message, one answer."""

import json

from langchain_core.messages import HumanMessage


def run(client, model):
    # region snippet
    response = client(model).invoke([HumanMessage("Reply with exactly: pong")])
    # endregion snippet
    reason = response.response_metadata.get("finish_reason")
    return {
        "text": str(response.content),
        "finish_reason": reason.lower() if reason else None,
        "usage": dict(response.usage_metadata) if response.usage_metadata else None,
    }


if __name__ == "__main__":
    from llm import chat_model

    print(json.dumps(run(chat_model, "fast")))
