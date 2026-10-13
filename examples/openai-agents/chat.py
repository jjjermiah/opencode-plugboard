"""S1, plain chat through the OpenAI Agents SDK, on the Responses API or on Chat Completions.

The snippet is the agent and one run. `configure(api)` (outside it) points the SDK at plugboard: one client for the
whole run, tracing off (it would call OpenAI otherwise).

finish_reason is derived from the last model response: `tool_calls` if it holds a function call, else `stop`. The SDK
does not expose the wire finish_reason, so this is a mapping, not a read.
"""

import os

from agents import Agent, OpenAIChatCompletionsModel, OpenAIResponsesModel, Runner, set_tracing_disabled
from openai import AsyncOpenAI


# region snippet-model
def model_for(model: str, api: str):
    """The SDK model for one id on one API. A model object sends the id as given: the SDK's own string lookup would read
    `anthropic/...` or `openai/...` as a provider prefix. The run's variant is kebab-case (the summary pattern)."""
    set_tracing_disabled(True)
    client = AsyncOpenAI(base_url=os.environ["PLUGBOARD_BASE_URL"], api_key=os.environ["PLUGBOARD_KEY"])
    if api == "responses":
        return OpenAIResponsesModel(model=model, openai_client=client)
    return OpenAIChatCompletionsModel(model=model, openai_client=client)


# endregion snippet-model


def finish_reason(response) -> str:
    return "tool_calls" if any(getattr(item, "type", "") == "function_call" for item in response.output) else "stop"


def usage_of(response) -> dict | None:
    usage = response.usage
    return {"input_tokens": usage.input_tokens, "output_tokens": usage.output_tokens, "total_tokens": usage.total_tokens} if usage else None


def run(model: str, api: str) -> dict:
    # region snippet
    agent = Agent(name="pong", model=model_for(model, api), instructions="Answer tersely.")
    result = Runner.run_sync(agent, "Reply with exactly: pong")
    # endregion snippet
    last = result.raw_responses[-1]
    return {"text": str(result.final_output), "finish_reason": finish_reason(last), "usage": usage_of(last)}
