"""S5, image as a data URL in a multi-part message. ChatAnthropic converts the data URL into an Anthropic image block."""

from pathlib import Path

from langchain_core.messages import HumanMessage

from llm import chat_model, text_of

RED = (Path(__file__).resolve().parents[1] / "_shared" / "red32.dataurl.txt").read_text().strip()


def run(model):
    # region snippet
    message = chat_model(model).invoke(
        [HumanMessage(content=[{"type": "text", "text": "What color is this image? One word."}, {"type": "image_url", "image_url": {"url": RED}}])]
    )
    # endregion snippet
    return {"text": text_of(message.content)}


if __name__ == "__main__":
    import json

    print(json.dumps(run("fast")))
