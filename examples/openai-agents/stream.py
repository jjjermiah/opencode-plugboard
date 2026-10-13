"""S3, streaming text through the OpenAI Agents SDK, on the Responses API or on Chat Completions.

The snippet streams the run's events. `configure` and `finish_reason` come from chat.py.
"""

import asyncio

from agents import Agent, Runner

from chat import finish_reason, model_for, usage_of


def run(model: str, api: str) -> dict:
    async def go():
        # region snippet
        agent = Agent(name="pong", model=model_for(model, api), instructions="Answer tersely.")
        result = Runner.run_streamed(agent, "Reply with exactly: pong")
        async for _event in result.stream_events():
            pass
        # endregion snippet
        return result

    result = asyncio.run(go())
    last = result.raw_responses[-1]
    return {"text": str(result.final_output), "finish_reason": finish_reason(last), "usage": usage_of(last), "done": True}
