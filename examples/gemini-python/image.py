"""S5, image as inline bytes in a multi-part user turn."""

import os
from pathlib import Path

from google import genai
from google.genai import types

RED_PNG = Path(__file__).resolve().parents[1] / "_shared" / "red32.png"


def run(client, model):
    # region snippet
    # A 32px red PNG (examples/_shared/red32.png). Part.from_bytes takes the raw bytes and the mime type.
    response = client.models.generate_content(
        model=model,
        contents=[
            types.Content(
                role="user",
                parts=[
                    types.Part(text="What color is this image? One word."),
                    types.Part.from_bytes(data=RED_PNG.read_bytes(), mime_type="image/png"),
                ],
            )
        ],
        config=types.GenerateContentConfig(max_output_tokens=1024),
    )
    # endregion snippet
    return {"text": response.text or ""}


if __name__ == "__main__":
    base_url = os.environ.get("PLUGBOARD_BASE_URL", "http://127.0.0.1:4010/v1").removesuffix("/v1")
    client = genai.Client(api_key=os.environ["PLUGBOARD_KEY"], http_options=types.HttpOptions(base_url=base_url))
    print(run(client, "fast"))
