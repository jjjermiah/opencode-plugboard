"""The one client every scenario builds: ChatAnthropic pointed at plugboard. Scenario files take `chat_model` from here.
base_url is plugboard's base URL without the `/v1`: the SDK under ChatAnthropic adds `/v1/messages` itself."""

import os
from typing import Optional

# The harness counts requests: a client never retries, so a retry cannot show up as a second request.
NO_RETRIES = {"max_retries": 0}


# region snippet
def chat_model(model, **overrides):
    from langchain_anthropic import ChatAnthropic

    settings = {
        "model": model,
        "base_url": os.environ["PLUGBOARD_BASE_URL"].removesuffix("/v1"),
        "api_key": os.environ["PLUGBOARD_KEY"],
        "max_tokens": 1024,
        **NO_RETRIES,
    }
    settings.update(overrides)
    return ChatAnthropic(**settings)
    # endregion snippet


def finish_reason(reason: Optional[str]) -> Optional[str]:
    """Messages stop reasons, as the shared checks name them (the other examples' vocabulary)."""
    if reason is None:
        return None
    return {"end_turn": "stop", "stop_sequence": "stop", "tool_use": "tool_calls", "max_tokens": "length"}.get(reason, reason)


def text_of(content) -> str:
    """A message's text: the content is a string, or a list of blocks."""
    if isinstance(content, str):
        return content
    return "".join(block.get("text", "") for block in content if isinstance(block, dict) and block.get("type") == "text")
