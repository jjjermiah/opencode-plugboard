"""S1, plain chat, non-stream. The smallest call: one user message, one answer."""

import json
import os


def run(client, model):
    # region snippet
    response = client.chat.completions.create(model=model, messages=[{"role": "user", "content": "Reply with exactly: pong"}])
    # endregion snippet
    choice = response.choices[0]
    return {
        "text": choice.message.content or "",
        "finish_reason": choice.finish_reason,
        "usage": response.usage.model_dump(exclude_none=True) if response.usage else None,
    }


if __name__ == "__main__":
    from openai import OpenAI

    client = OpenAI(base_url=os.environ["PLUGBOARD_BASE_URL"], api_key=os.environ["PLUGBOARD_KEY"], max_retries=0)
    print(json.dumps(run(client, "fast")))
