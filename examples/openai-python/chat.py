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


def responses_finish_reason(response) -> str:
    """The Responses API has no finish_reason. A function call means `tool_calls`, a completed answer `stop`."""
    if any(item.type == "function_call" for item in response.output):
        return "tool_calls"
    return "stop" if response.status == "completed" else response.status


def run_responses(client, model):
    # region snippet-responses
    response = client.responses.create(model=model, input="Reply with exactly: pong", max_output_tokens=1024)
    # endregion snippet-responses
    return {
        "text": response.output_text,
        "finish_reason": responses_finish_reason(response),
        "usage": response.usage.model_dump(exclude_none=True) if response.usage else None,
    }


if __name__ == "__main__":
    from openai import OpenAI

    client = OpenAI(base_url=os.environ["PLUGBOARD_BASE_URL"], api_key=os.environ["PLUGBOARD_KEY"], max_retries=0)
    print(json.dumps(run(client, "fast")))
