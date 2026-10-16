"""The one client every scenario builds: ChatOpenAI pointed at plugboard. Scenario files take it as `client`."""

import os

# The harness counts requests: a client never retries, so a retry cannot show up as a second request.
NO_RETRIES = {"max_retries": 0}


# region snippet
def chat_model(model, **overrides):
    from langchain_openai import ChatOpenAI

    settings = {
        "base_url": os.environ["PLUGBOARD_BASE_URL"],  # ends in /v1
        "api_key": os.environ["PLUGBOARD_KEY"],
        "model": model,
        "use_responses_api": False,  # Chat Completions. Left unset, a gpt-5.6 id can switch to /v1/responses
        **NO_RETRIES,
    }
    if model == "fast":
        settings["max_tokens"] = 1024  # fast is a reasoning model: leave room for the answer after its thinking
    settings.update(overrides)
    return ChatOpenAI(**settings)
    # endregion snippet


def responses_model(model, **overrides):
    """The same client on the Responses API (`/v1/responses`). Set explicitly: LangChain also switches on its own for gpt-5.6 ids."""
    return chat_model(model, use_responses_api=True, **overrides)
