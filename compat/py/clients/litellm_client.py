"""LiteLLM as a client (litellm, #227) against plugboard.

litellm.completion with the `openai/` prefix, so it takes the OpenAI Chat Completions path. Text,
streaming, a tool round trip and structured output (a pydantic response_format).
Run through `bun run compat:python`, or directly with PLUGBOARD_URL and PLUGBOARD_KEY set.
"""

import json
import os

# The price map is bundled; without this LiteLLM fetches it from GitHub on import.
os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")

import litellm  # noqa: E402
from _common import MODEL, PONG_PROMPT, WEATHER_PARAMS, WEATHER_PROMPT, WEATHER_RESULT, api_key, base_url, main, require  # noqa: E402
from pydantic import BaseModel  # noqa: E402

CLIENT = "litellm"
MODEL_ID = f"openai/{MODEL}"  # the openai/ prefix selects the Chat Completions route
litellm.telemetry = False
TOOL = {"type": "function", "function": {"name": "get_weather", "description": "Current weather for a city", "parameters": WEATHER_PARAMS}}


class Answer(BaseModel):
    answer: str


def call(**kwargs):
    return litellm.completion(model=MODEL_ID, api_base=base_url(), api_key=api_key(), **kwargs)


def completion() -> str:
    r = call(messages=[{"role": "user", "content": PONG_PROMPT}])
    text = r.choices[0].message.content or ""
    require("pong" in text.lower(), f"content={text!r}")
    return f"content={text!r} finish={r.choices[0].finish_reason} total_tokens={r.usage.total_tokens}"


def stream() -> str:
    chunks = list(call(messages=[{"role": "user", "content": PONG_PROMPT}], stream=True))
    text = "".join(c.choices[0].delta.content or "" for c in chunks if c.choices)
    require(len(chunks) >= 2, f"chunks={len(chunks)}")
    require("pong" in text.lower(), f"text={text!r}")
    return f"chunks={len(chunks)} text={text!r}"


def tool() -> str:
    messages = [{"role": "user", "content": WEATHER_PROMPT}]
    first = call(messages=messages, tools=[TOOL])
    msg = first.choices[0].message
    require(first.choices[0].finish_reason == "tool_calls", f"finish={first.choices[0].finish_reason}")
    require(msg.tool_calls and msg.tool_calls[0].function.name == "get_weather", f"tool_calls={msg.tool_calls}")
    args = json.loads(msg.tool_calls[0].function.arguments)
    require("paris" in args["city"].lower(), f"args={args}")
    messages += [msg.model_dump(exclude_none=True), {"role": "tool", "tool_call_id": msg.tool_calls[0].id, "content": WEATHER_RESULT}]
    second = call(messages=messages, tools=[TOOL])
    final = second.choices[0].message.content or ""
    require("18" in final or "cloud" in final.lower(), f"final={final!r}")
    return f"args={args} final={final!r}"


def structured() -> str:
    r = call(messages=[{"role": "user", "content": "What is 6 times 7? Answer in the answer field."}], response_format=Answer)
    parsed = Answer.model_validate_json(r.choices[0].message.content or "")
    return f"parsed={parsed.model_dump()}"


SCENARIOS = [
    ("completion", completion),
    ("stream", stream),
    ("tool", tool),
    ("structured", structured),
]

if __name__ == "__main__":
    main(CLIENT, SCENARIOS)
