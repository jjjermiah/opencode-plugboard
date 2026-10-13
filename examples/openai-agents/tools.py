"""S2, tool call and tool-result turn through the OpenAI Agents SDK. The SDK runs the tool and sends the result back itself.

The snippet is the agent with one function tool. `configure` and `finish_reason` come from chat.py.
"""

from agents import Agent, Runner, function_tool

from chat import finish_reason, model_for, usage_of

WEATHER_PROMPT = "What is the weather in Paris? Use the tool."
tool_calls: list[str] = []


def run(model: str, api: str) -> dict:
    tool_calls.clear()

    # region snippet
    @function_tool
    def get_weather(city: str) -> str:
        """Current weather for a city."""
        tool_calls.append(city)
        return '{"temp_c": 18, "sky": "cloudy"}'

    agent = Agent(name="weather", model=model_for(model, api), instructions="Use the tool.", tools=[get_weather])
    result = Runner.run_sync(agent, WEATHER_PROMPT)
    # endregion snippet
    first = result.raw_responses[0]
    call = next(item for item in first.output if getattr(item, "type", "") == "function_call")
    last = result.raw_responses[-1]
    return {
        "finish_reason": finish_reason(first),
        "tool_name": call.name,
        "tool_city": tool_calls[0] if tool_calls else "",
        "tool_call_id": call.call_id,
        "final_text": str(result.final_output),
        "final_finish_reason": finish_reason(last),
        "usage": usage_of(last),
    }
