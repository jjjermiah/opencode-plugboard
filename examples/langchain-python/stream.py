"""S3, streaming text, with and without usage. LangChain folds the chunks into one AIMessageChunk with `+`."""

import json
import operator
from functools import reduce

PROMPT = "Reply with exactly: pong"


def run(client, model):
    # region snippet
    chunks = list(client(model, stream_usage=True).stream(PROMPT))  # stream_usage asks for the usage chunk
    full = reduce(operator.add, chunks)
    # endregion snippet
    # Without usage the stream still carries the text.
    plain = "".join(chunk.text for chunk in client(model, stream_usage=False).stream(PROMPT))
    if "pong" not in plain.lower():
        raise AssertionError(f"stream without usage gave {plain!r}")
    return {
        "text": full.text,  # the text of every content block; the Responses path returns a list of blocks
        "finish_reason": full.response_metadata.get("finish_reason"),
        "usage": full.usage_metadata,
        "done": True,  # LangChain stops reading only after the server's [DONE], so the loop ending means it came
    }


if __name__ == "__main__":
    from llm import chat_model

    print(json.dumps(run(chat_model, "fast")))
