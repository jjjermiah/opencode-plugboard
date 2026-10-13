"""S5, an image as a data URL in a multi-part message, and as LangChain's standard image block."""

import json
from pathlib import Path

RED = (Path(__file__).resolve().parents[1] / "_shared" / "red32.dataurl.txt").read_text().strip()
QUESTION = "What color is this image? One word."


def run(client, model):
    from langchain_core.messages import HumanMessage

    # region snippet
    message = client(model).invoke(
        [HumanMessage(content=[{"type": "text", "text": QUESTION}, {"type": "image_url", "image_url": {"url": RED}}])]
    )
    # endregion snippet
    # The standard block form: LangChain converts it to image_url on the wire.
    block = client(model).invoke(
        [HumanMessage(content=[{"type": "text", "text": QUESTION}, {"type": "image", "base64": RED.split(",", 1)[1], "mime_type": "image/png"}])]
    )
    if "red" not in str(block.content).lower():
        raise AssertionError(f"standard image block gave {block.content!r}")
    return {"text": str(message.content)}


if __name__ == "__main__":
    from llm import chat_model

    print(json.dumps(run(chat_model, "fast")))
