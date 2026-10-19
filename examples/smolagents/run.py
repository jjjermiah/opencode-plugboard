"""Runner for the smolagents example: OpenAIModel and a ToolCallingAgent. Started by examples/_harness/run.ts, which captures
the traffic and writes the run. This file writes nothing: it prints one JSON line per scenario and model.

    uv run --frozen run.py          # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness

The scenarios are the ones in example.py: S1 text (generate), S3 stream (generate_stream), S2 tool call and round trip
(ToolCallingAgent). Two rows are gaps, not passes, and the note on each says why (see the GAPS dict below).
"""

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "_harness" / "py"))

import harness  # noqa: E402
from smolagents import ActionStep, OpenAIModel, ToolCallingAgent, tool  # noqa: E402
from smolagents.monitoring import LogLevel  # noqa: E402

BASE = os.environ["PLUGBOARD_BASE_URL"]
KEY = os.environ["PLUGBOARD_KEY"]
PROMPT = "Reply with exactly: pong"
TOOL_PROMPT = "What is the weather in Paris? Use the tool."

# Known gaps, reported as `gap` (not `fail`) with the reason. They are limits of the scripted fake or of smolagents'
# API, not plugboard faults. Each row's checks are still recorded, so the row shows which checks held.
GAPS = {
    "S2": {
        "note": "smolagents ends a run with a final_answer tool call, so its last model turn finishes with tool_calls, and the check expects stop; the tool call and the final answer are observed and pass",
        "issue": "#362",
    },
}

# Checks smolagents cannot observe: left out of the row, and the note names them (#370).
UNOBSERVED = {
    "S3": {"finish_reason is stop": "smolagents' generate_stream does not return finish_reason; the streamed text, usage and end of stream are checked"},
}


# region snippet-tool
@tool
def get_weather(city: str) -> str:
    """Current weather for a city.

    Args:
        city: The city name.
    """
    return '{"temp_c": 18, "sky": "cloudy"}'
# endregion snippet-tool


def s1(model_id: str):
    # region snippet
    model = OpenAIModel(model_id=model_id, api_base=BASE, api_key=KEY, max_completion_tokens=1024)
    message = model.generate([{"role": "user", "content": [{"type": "text", "text": PROMPT}]}])
    # endregion snippet
    response = message.raw  # the ChatCompletion smolagents got back
    choice = response.choices[0]
    return {
        "text": message.content or "",
        "finish_reason": choice.finish_reason,
        "usage": response.usage.model_dump(exclude_none=True) if response.usage else None,
    }


def s2(model_id: str):
    model = OpenAIModel(model_id=model_id, api_base=BASE, api_key=KEY, max_completion_tokens=1024)
    # region snippet-agent
    agent = ToolCallingAgent(tools=[get_weather], model=model, max_steps=4, verbosity_level=LogLevel.OFF)
    answer = agent.run(TOOL_PROMPT)
    # endregion snippet-agent
    steps = [step for step in agent.memory.steps if isinstance(step, ActionStep)]
    first = steps[0]
    call = first.tool_calls[0]
    arguments = call.arguments if isinstance(call.arguments, dict) else json.loads(call.arguments or "{}")
    # The last step that called the model. A run that hits max_steps ends on a step with no model output.
    last = [step for step in steps if step.model_output_message is not None][-1]
    return {
        "finish_reason": first.model_output_message.raw.choices[0].finish_reason,
        "tool_name": call.name,
        "tool_city": arguments.get("city", ""),
        "tool_call_id": call.id,
        # A run with an errored step has no final answer; its error text is not one (it can echo the tool result).
        "final_text": "" if any(step.error for step in steps) else str(answer),
        "final_finish_reason": last.model_output_message.raw.choices[0].finish_reason,
    }


def s3(model_id: str):
    model = OpenAIModel(model_id=model_id, api_base=BASE, api_key=KEY, max_completion_tokens=1024)
    # region snippet-stream
    deltas = list(model.generate_stream([{"role": "user", "content": [{"type": "text", "text": PROMPT}]}]))
    # endregion snippet-stream
    usage = next((delta.token_usage for delta in deltas if delta.token_usage is not None), None)
    return {
        "text": "".join(delta.content or "" for delta in deltas),
        # smolagents does not expose the finish reason of a stream: null here, which the check reports.
        "finish_reason": None,
        "usage": {"input_tokens": usage.input_tokens, "output_tokens": usage.output_tokens} if usage else None,
        "done": True,
    }


def main() -> None:
    harness.emit_client("smolagents")
    harness.run_all({"S1": s1, "S2": s2, "S3": s3}, gaps=GAPS, unobserved=UNOBSERVED)


if __name__ == "__main__":
    main()
