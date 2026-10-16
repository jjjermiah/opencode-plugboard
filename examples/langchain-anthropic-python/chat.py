"""S1, plain chat, non-stream: one invoke, one answer. Copy this shape for any text generation."""

from llm import chat_model, finish_reason, text_of


def run(model):
    # region snippet
    message = chat_model(model).invoke("Reply with exactly: pong")
    # endregion snippet
    return {
        "text": text_of(message.content),
        "finish_reason": finish_reason(message.response_metadata.get("stop_reason")),
        "usage": dict(message.usage_metadata) if message.usage_metadata else None,
    }


if __name__ == "__main__":
    import json

    print(json.dumps(run("fast")))
