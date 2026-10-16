"""S1, plain chat, non-stream: the smallest call. Copy this shape for any text generation."""

from provider import client, finish_reason


def run(model):
    # region snippet
    message = client.messages.create(model=model, max_tokens=1024, messages=[{"role": "user", "content": "Reply with exactly: pong"}])
    # endregion snippet
    text = "".join(block.text for block in message.content if block.type == "text")
    return {"text": text, "finish_reason": finish_reason(message.stop_reason), "usage": message.usage.model_dump()}


if __name__ == "__main__":
    import json

    print(json.dumps(run("fast")))
