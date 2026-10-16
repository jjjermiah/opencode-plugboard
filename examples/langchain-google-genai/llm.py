"""The chat model every scenario uses. The factory takes a plugboard model id and an optional key, so E1 can make a wrong-key client."""

import os

from langchain_google_genai import ChatGoogleGenerativeAI

# ChatGoogleGenerativeAI adds /v1beta itself, so the base URL is the plugboard origin, not the /v1 the OpenAI examples take.
BASE_URL = os.environ.get("PLUGBOARD_BASE_URL", "http://127.0.0.1:4010/v1").removesuffix("/v1")


def wire(model: str) -> str:
    """A bare # starts a URL fragment, so the variant goes as %23 (docs/gemini.md, Model names). A / goes as it is."""
    return model.replace("#", "%23")


def chat_model(model: str, api_key: str | None = None) -> ChatGoogleGenerativeAI:
    # region snippet-client
    return ChatGoogleGenerativeAI(
        model=wire(model),
        google_api_key=api_key or os.environ.get("PLUGBOARD_KEY", ""),
        base_url=BASE_URL,
        max_output_tokens=1024,
        max_retries=0,
    )
    # endregion snippet-client
