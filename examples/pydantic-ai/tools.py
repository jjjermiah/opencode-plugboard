"""S2, tool call and tool-result turn. pydantic-ai runs the tool and sends the result back itself."""

import asyncio
import json
import os

from openai import AsyncOpenAI
from pydantic_ai import Agent
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models import ModelSettings
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

PROMPT = "What is the weather in Paris? Use the tool."


async def run(client, model):
    # region snippet
    agent = Agent(OpenAIChatModel(model, provider=OpenAIProvider(openai_client=client), settings=ModelSettings(max_tokens=1024)))

    @agent.tool_plain
    def get_weather(city: str) -> dict:
        """Get the current weather for a city."""
        return {"temp_c": 18, "sky": "cloudy"}

    result = await agent.run(PROMPT)
    # endregion snippet
    responses = [message for message in result.all_messages() if isinstance(message, ModelResponse)]
    call = next(part for part in responses[0].parts if isinstance(part, ToolCallPart))
    return {
        # pydantic-ai names the wire value tool_calls "tool_call"; the observation keeps the wire name
        "finish_reason": "tool_calls" if responses[0].finish_reason == "tool_call" else responses[0].finish_reason,
        "tool_name": call.tool_name,
        "tool_city": call.args_as_dict().get("city", ""),
        "tool_call_id": call.tool_call_id,
        "final_text": result.output,
        "final_finish_reason": responses[-1].finish_reason,
    }


if __name__ == "__main__":
    client = AsyncOpenAI(base_url=os.environ["PLUGBOARD_BASE_URL"], api_key=os.environ["PLUGBOARD_KEY"], max_retries=0)
    print(json.dumps(asyncio.run(run(client, "fast"))))
