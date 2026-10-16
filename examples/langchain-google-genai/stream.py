"""S3, streaming text. Gemini sends usage metadata on the last chunk, so the stream always carries usage."""

import json

from langchain_core.messages import HumanMessage


def run(client, model):
    # region snippet
    text = ""
    finish = None
    usage = None
    for chunk in client(model).stream([HumanMessage("Reply with exactly: pong")]):
        text += str(chunk.content)  # each chunk carries the next text delta
        finish = chunk.response_metadata.get("finish_reason") or finish
        usage = dict(chunk.usage_metadata) if chunk.usage_metadata else usage
    # endregion snippet
    if not text:
        raise RuntimeError("the stream sent no text")
    return {"text": text, "finish_reason": finish.lower() if finish else None, "usage": usage, "done": True}


if __name__ == "__main__":
    from llm import chat_model

    print(json.dumps(run(chat_model, "fast")))
