"""S1, plain chat, non-stream. The smallest call: one string of contents, one answer."""

import os

from google import genai
from google.genai import types


def run(client, model):
    # region snippet
    response = client.models.generate_content(model=model, contents="Reply with exactly: pong", config=types.GenerateContentConfig(max_output_tokens=1024))
    # endregion snippet
    reason = response.candidates[0].finish_reason if response.candidates else None
    return {
        "text": response.text or "",
        "finish_reason": reason.value.lower() if reason else None,
        "usage": response.usage_metadata.model_dump(exclude_none=True) if response.usage_metadata else None,
    }


if __name__ == "__main__":
    base_url = os.environ.get("PLUGBOARD_BASE_URL", "http://127.0.0.1:4010/v1").removesuffix("/v1")
    client = genai.Client(api_key=os.environ["PLUGBOARD_KEY"], http_options=types.HttpOptions(base_url=base_url))
    print(run(client, "fast"))
