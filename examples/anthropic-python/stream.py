"""S3, streaming text. Read the text stream for the deltas; the final message carries the usage. Messages always reports
usage, so there is no include-usage switch to set."""

from provider import client, finish_reason

PROMPT = "Reply with exactly: pong"


def run(model):
    # region snippet
    text = ""
    with client.messages.stream(model=model, max_tokens=1024, messages=[{"role": "user", "content": PROMPT}]) as stream:
        for piece in stream.text_stream:
            text += piece
        message = stream.get_final_message()
    # endregion snippet
    return {"text": text, "finish_reason": finish_reason(message.stop_reason), "usage": message.usage.model_dump(), "done": True}


if __name__ == "__main__":
    import json

    print(json.dumps(run("fast")))
