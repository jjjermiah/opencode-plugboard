"""The AutoGen LLMConfig for plugboard, on both routes. Each scenario file imports `config` from here.

`PLUGBOARD_BASE_URL` is plugboard's `/v1` URL and `PLUGBOARD_KEY` is the app key. The harness sets both; by hand the URL defaults to a local
server and the key must be set.
"""

import os

from autogen import LLMConfig

# region snippet
BASE = os.environ.get("PLUGBOARD_BASE_URL", "http://127.0.0.1:4010/v1")
KEY = os.environ["PLUGBOARD_KEY"]


def llm_config(model: str = "fast", stream: bool = False) -> LLMConfig:
    return LLMConfig(
        {
            "api_type": "openai",
            "model": model,
            "base_url": BASE,
            "api_key": KEY,
            "max_tokens": 1024,
            "stream": stream,
        }
    )
# endregion snippet


# region snippet-anthropic
def anthropic_config(model: str = "fast") -> LLMConfig:
    return LLMConfig(
        {
            "api_type": "anthropic",
            "model": model,
            # The Anthropic SDK adds /v1/messages itself: pass the address without /v1.
            "base_url": BASE.removesuffix("/v1"),
            "api_key": KEY,
            "max_tokens": 1024,
        }
    )
# endregion snippet-anthropic


def config(model: str, route: str = "chat", stream: bool = False) -> LLMConfig:
    """`llm_config` on the `chat` route (Chat Completions), `anthropic_config` on the `messages` route."""
    return anthropic_config(model) if route == "messages" else llm_config(model, stream)
