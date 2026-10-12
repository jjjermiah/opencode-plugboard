"""S5, image as a data URL in a multi-part user message."""

import json
import os
from pathlib import Path

RED = (Path(__file__).resolve().parents[1] / "_shared" / "red32.dataurl.txt").read_text().strip()


def run(client, model):
    # region snippet
    response = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "What color is this image? One word."},
                    {"type": "image_url", "image_url": {"url": RED}},
                ],
            }
        ],
    )
    # endregion snippet
    return {"text": response.choices[0].message.content or ""}


if __name__ == "__main__":
    from openai import OpenAI

    client = OpenAI(base_url=os.environ["PLUGBOARD_BASE_URL"], api_key=os.environ["PLUGBOARD_KEY"], max_retries=0)
    print(json.dumps(run(client, "fast")))
