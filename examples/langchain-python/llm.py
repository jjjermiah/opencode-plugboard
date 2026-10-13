"""The one client every scenario builds: ChatOpenAI pointed at plugboard. Scenario files take it as `client`."""

import os


def chat_model(model, **overrides):
    # region snippet
    from langchain_openai import ChatOpenAI

    settings = {
        "base_url": os.environ["PLUGBOARD_BASE_URL"],  # ends in /v1
        "api_key": os.environ["PLUGBOARD_KEY"],
        "model": model,
        "use_responses_api": False,  # Chat Completions. Left unset, a gpt-5.6 id can switch to /v1/responses
        "max_retries": 0,  # the harness counts requests, so a retry must not show up as a second one
    }
    if model == "fast":
        settings["max_tokens"] = 1024  # fast is a reasoning model: leave room for the answer after its thinking
    settings.update(overrides)
    return ChatOpenAI(**settings)
    # endregion snippet
