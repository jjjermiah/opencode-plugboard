"""S5, image as base64 in an image block. The fixture is a data URL; the Messages API wants the bare base64 and the media type."""

from pathlib import Path

from provider import client

RED = (Path(__file__).resolve().parents[1] / "_shared" / "red32.dataurl.txt").read_text().strip()
BASE64 = RED.removeprefix("data:image/png;base64,")


def run(model):
    # region snippet
    message = client.messages.create(
        model=model,
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": BASE64}},
                    {"type": "text", "text": "What color is this image? One word."},
                ],
            }
        ],
    )
    # endregion snippet
    return {"text": "".join(block.text for block in message.content if block.type == "text")}


if __name__ == "__main__":
    import json

    print(json.dumps(run("fast")))
