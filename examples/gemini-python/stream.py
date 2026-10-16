"""S3, streaming text. Gemini sends usage_metadata on the last chunk, so the stream always carries usage."""

import os

from google import genai
from google.genai import types


def run(client, model):
    # region snippet
    text = ""
    finish = None
    usage = None
    for chunk in client.models.generate_content_stream(model=model, contents="Reply with exactly: pong", config=types.GenerateContentConfig(max_output_tokens=1024)):
        text += chunk.text or ""  # each chunk carries the next text delta
        if chunk.candidates and chunk.candidates[0].finish_reason:
            finish = chunk.candidates[0].finish_reason.value.lower()
        if chunk.usage_metadata:
            usage = chunk.usage_metadata.model_dump(exclude_none=True)
    # endregion snippet
    if not text:
        raise RuntimeError("the stream sent no text")
    return {"text": text, "finish_reason": finish, "usage": usage, "done": True}


if __name__ == "__main__":
    base_url = os.environ.get("PLUGBOARD_BASE_URL", "http://127.0.0.1:4010/v1").removesuffix("/v1")
    client = genai.Client(api_key=os.environ["PLUGBOARD_KEY"], http_options=types.HttpOptions(base_url=base_url))
    print(run(client, "fast"))
