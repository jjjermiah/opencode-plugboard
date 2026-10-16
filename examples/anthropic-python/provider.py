"""The Anthropic SDK client for plugboard's Messages route. Each scenario file imports `client` from here. The SDK adds
`/v1/messages` to its base URL itself, so the base URL is plugboard's `/v1` URL without the `/v1`."""

import os
from typing import Optional

from anthropic import Anthropic

# region snippet
client = Anthropic(base_url=os.environ["PLUGBOARD_BASE_URL"].removesuffix("/v1"), api_key=os.environ["PLUGBOARD_KEY"], max_retries=0)
# endregion snippet


def finish_reason(reason: Optional[str]) -> Optional[str]:
    """The Messages API says `end_turn` and `tool_use`; the shared checks say `stop` and `tool_calls` (as the other examples)."""
    if reason is None:
        return None
    return {"end_turn": "stop", "stop_sequence": "stop", "tool_use": "tool_calls", "max_tokens": "length"}.get(reason, reason)
