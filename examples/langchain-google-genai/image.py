"""S5, image as a data URL in a multi-part human message."""

import json
from pathlib import Path

from langchain_core.messages import HumanMessage

RED_PNG = Path(__file__).resolve().parents[1] / "_shared" / "red32.dataurl.txt"


def run(client, model):
    # region snippet
    # A 32px red PNG as a data URL (examples/_shared/red32.dataurl.txt). LangChain converts it to inline data for Gemini.
    red = RED_PNG.read_text().strip()
    response = client(model).invoke(
        [HumanMessage(content=[{"type": "text", "text": "What color is this image? One word."}, {"type": "image_url", "image_url": {"url": red}}])]
    )
    # endregion snippet
    return {"text": str(response.content)}


if __name__ == "__main__":
    from llm import chat_model

    print(json.dumps(run(chat_model, "fast")))
