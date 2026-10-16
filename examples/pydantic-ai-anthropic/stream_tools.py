"""S4, streaming tool call. The events show the tool call as it streams; the tool runs once the call is complete."""

import asyncio
import json

from pydantic_ai import Agent
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.run import AgentRunResultEvent

from llm import chat_model, finish_reason, make_client

PROMPT = "What is the weather in Paris? Use the tool."


async def run(client, model):
    # region snippet
    agent = Agent(chat_model(client, model))

    @agent.tool_plain
    def get_weather(city: str) -> dict:
        """Get the current weather for a city."""
        return {"temp_c": 18, "sky": "cloudy"}

    result = None
    async with agent.run_stream_events(PROMPT) as events:
        async for event in events:
            if isinstance(event, AgentRunResultEvent):
                result = event.result
    # endregion snippet
    responses = [message for message in result.all_messages() if isinstance(message, ModelResponse)]
    call = next(part for part in responses[0].parts if isinstance(part, ToolCallPart))
    return {
        "finish_reason": finish_reason(responses[0].finish_reason),
        "tool_name": call.tool_name,
        "tool_city": call.args_as_dict().get("city", ""),
        "tool_call_id": call.tool_call_id,
    }


if __name__ == "__main__":
    print(json.dumps(asyncio.run(run(make_client(), "fast"))))
