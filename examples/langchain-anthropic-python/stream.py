"""S3, streaming text. Each chunk carries a piece of the text; the message_delta chunk carries the stop reason and the usage."""

from llm import chat_model, finish_reason, text_of

PROMPT = "Reply with exactly: pong"


def run(model):
    text = ""
    finish = None
    usage = None
    # region snippet
    for chunk in chat_model(model).stream(PROMPT):
        text += text_of(chunk.content)
        # The last chunk (the message_delta) carries the stop reason in response_metadata.
        if chunk.response_metadata.get("stop_reason"):
            finish = finish_reason(chunk.response_metadata["stop_reason"])
        if chunk.usage_metadata:
            usage = dict(chunk.usage_metadata)
    # endregion snippet
    return {"text": text, "finish_reason": finish, "usage": usage, "done": finish is not None}


if __name__ == "__main__":
    import json

    print(json.dumps(run("fast")))
