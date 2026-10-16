"""The client and model every scenario builds: pydantic-ai's AnthropicModel over an Anthropic SDK client pointed at plugboard.
The SDK adds `/v1/messages` to its base URL itself, so the base URL is plugboard's `/v1` URL without the `/v1`."""

import os
from typing import Optional

from anthropic import AsyncAnthropic
from pydantic_ai import ModelSettings
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.providers.anthropic import AnthropicProvider


def make_client(api_key: Optional[str] = None) -> AsyncAnthropic:
    # The harness counts requests: a client never retries, so a retry cannot show up as a second request.
    return AsyncAnthropic(base_url=os.environ["PLUGBOARD_BASE_URL"].removesuffix("/v1"), api_key=api_key or os.environ["PLUGBOARD_KEY"], max_retries=0)


# region snippet
def chat_model(client: AsyncAnthropic, model: str) -> AnthropicModel:
    return AnthropicModel(model, provider=AnthropicProvider(anthropic_client=client), settings=ModelSettings(max_tokens=1024))
# endregion snippet


def finish_reason(reason: Optional[str]) -> Optional[str]:
    """pydantic-ai names a tool turn `tool_call`; the shared checks say `tool_calls` (as the other examples)."""
    return "tool_calls" if reason == "tool_call" else reason
