# /// script
# requires-python = ">=3.10"
# dependencies = ["langfuse==4.17.0", "openai==3.29.0"]
# ///
"""Langfuse's OpenAI wrapper through plugboard: text, stream and one tool round trip.

    PLUGBOARD_KEY=<app key> uv run example.py

The wrapper is the only change from the plain OpenAI SDK: `from langfuse.openai import OpenAI`.
Tracing goes to Langfuse only when LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are set (and
LANGFUSE_BASE_URL points at your instance). Without them this script sets LANGFUSE_TRACING_ENABLED=false
so no Langfuse server is needed. PLUGBOARD_URL is the base with /v1 (default http://127.0.0.1:4010/v1).
"""

import json
import os
import sys

if not os.environ.get("LANGFUSE_PUBLIC_KEY"):
    os.environ.setdefault("LANGFUSE_TRACING_ENABLED", "false")

from langfuse.openai import OpenAI  # noqa: E402

URL = os.environ.get("PLUGBOARD_URL", "http://127.0.0.1:4010/v1")
KEY = os.environ["PLUGBOARD_KEY"]

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Current weather for a city.",
            "parameters": {
                "type": "object",
                "properties": {"city": {"type": "string"}},
                "required": ["city"],
            },
        },
    }
]


def check(name: str, ok: bool, detail: str = "") -> bool:
    print(f"{name}: {'pass' if ok else 'fail'} {detail}".rstrip())
    return ok


def main() -> int:
    client = OpenAI(base_url=URL, api_key=KEY)
    results = []

    # 1. Text.
    r = client.chat.completions.create(
        model="fast",
        messages=[{"role": "user", "content": "Reply with exactly: pong"}],
        max_completion_tokens=1024,
        name="langfuse-example-text",
    )
    text = r.choices[0].message.content or ""
    results.append(check("text", "pong" in text.lower(), repr(text[:40])))

    # 2. Stream.
    stream = client.chat.completions.create(
        model="fast",
        messages=[{"role": "user", "content": "Reply with exactly: pong"}],
        max_completion_tokens=1024,
        stream=True,
        name="langfuse-example-stream",
    )
    parts = []
    for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            parts.append(chunk.choices[0].delta.content)
    streamed = "".join(parts)
    results.append(check("stream", "pong" in streamed.lower(), repr(streamed[:40])))

    # 3. One tool call, then the tool result back to the model.
    messages = [{"role": "user", "content": "What is the weather in Paris? Use the tool."}]
    first = client.chat.completions.create(
        model="fast",
        messages=messages,
        tools=TOOLS,
        max_completion_tokens=1024,
        name="langfuse-example-tool",
    )
    msg = first.choices[0].message
    calls = msg.tool_calls or []
    called = [c for c in calls if c.function.name == "get_weather"]
    results.append(check("tool call", bool(called), f"{len(calls)} call(s)"))
    if called:
        messages.append(msg.model_dump(exclude_none=True))
        for c in called:
            args = json.loads(c.function.arguments or "{}")
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": c.id,
                    "content": json.dumps({"city": args.get("city"), "temp_c": 18, "sky": "cloudy"}),
                }
            )
        final = client.chat.completions.create(
            model="fast",
            messages=messages,
            tools=TOOLS,
            max_completion_tokens=1024,
            name="langfuse-example-tool-result",
        )
        answer = final.choices[0].message.content or ""
        results.append(check("tool round trip", "18" in answer, repr(answer[:60])))
    else:
        results.append(check("tool round trip", False, "no get_weather call to answer"))

    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
