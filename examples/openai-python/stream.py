"""S3, streaming text, with and without usage. Raw chunks, then the SDK's stream helper, which must agree."""

import json
import os


def run(client, model):
    messages = [{"role": "user", "content": "Reply with exactly: pong"}]
    # region snippet
    stream = client.chat.completions.create(model=model, messages=messages, stream=True, stream_options={"include_usage": True})
    text, finish, usage = "", None, None
    for chunk in stream:  # the SDK stops here when the server sends [DONE]
        if chunk.usage:
            usage = chunk.usage.model_dump(exclude_none=True)
        for choice in chunk.choices:
            text += choice.delta.content or ""
            finish = choice.finish_reason or finish
    # endregion snippet
    # The helper accumulates the same chunks into a snapshot; it must give the same text.
    with client.chat.completions.stream(model=model, messages=messages, stream_options={"include_usage": True}) as helper:
        for _ in helper:
            pass
        helper_text = helper.get_final_completion().choices[0].message.content or ""
    if helper_text != text:
        raise AssertionError(f"stream helper text {helper_text!r} differs from the raw stream {text!r}")
    return {"text": text, "finish_reason": finish, "usage": usage, "done": True}


if __name__ == "__main__":
    from openai import OpenAI

    client = OpenAI(base_url=os.environ["PLUGBOARD_BASE_URL"], api_key=os.environ["PLUGBOARD_KEY"], max_retries=0)
    print(json.dumps(run(client, "fast")))
