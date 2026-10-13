"""S1 and S3, LiteLLM as a client: a completion, and a stream with usage.

litellm.completion with the `openai/` prefix takes the OpenAI Chat Completions path. The snippets build the call
themselves; `plugboard()` (outside them) reads PLUGBOARD_BASE_URL and PLUGBOARD_KEY, as run.py does.
"""

import os

# The price map is bundled; without this LiteLLM fetches it from GitHub on import.
os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")

import litellm  # noqa: E402

litellm.telemetry = False


# region snippet-client
def plugboard(model: str, **kwargs):
    return litellm.completion(model=f"openai/{model}", api_base=os.environ["PLUGBOARD_BASE_URL"], api_key=os.environ["PLUGBOARD_KEY"], **kwargs)


# endregion snippet-client


def run(model: str) -> dict:
    # region snippet
    response = litellm.completion(
        model="openai/fast",
        api_base=os.environ["PLUGBOARD_BASE_URL"],
        api_key=os.environ["PLUGBOARD_KEY"],
        messages=[{"role": "user", "content": "Reply with exactly: pong"}],
    )
    # endregion snippet
    return {
        "text": response.choices[0].message.content or "",
        "finish_reason": response.choices[0].finish_reason,
        "usage": response.usage.model_dump(exclude_none=True) if response.usage else None,
    }


def stream(model: str) -> dict:
    # region snippet-stream
    chunks = list(
        plugboard(model, messages=[{"role": "user", "content": "Reply with exactly: pong"}], stream=True, stream_options={"include_usage": True})
    )
    # endregion snippet-stream
    text = "".join(chunk.choices[0].delta.content or "" for chunk in chunks if chunk.choices)
    finish = next((chunk.choices[0].finish_reason for chunk in reversed(chunks) if chunk.choices and chunk.choices[0].finish_reason), None)
    usage = next((chunk.usage.model_dump(exclude_none=True) for chunk in reversed(chunks) if getattr(chunk, "usage", None)), None)
    return {"text": text, "finish_reason": finish, "usage": usage, "done": True}
