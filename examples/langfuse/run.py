"""Runner for the Langfuse example: Langfuse's OpenAI wrapper with tracing on. Started by examples/_harness/run.ts, which
captures the traffic and writes the run. This file writes nothing: it prints one JSON line per scenario and model.

    uv run --frozen run.py          # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness

The scenarios are the ones in example.py: S1 text, S2 tool round trip, S3 stream. S8 checks the trace of one call: the SDK sends
it to fake_langfuse.py, a Langfuse ingestion endpoint on loopback, and the runner reads back what arrived.
"""

import json
import os
import sys
from pathlib import Path

SHARED = Path(__file__).resolve().parents[1] / "_shared"
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "_harness" / "py"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fake_langfuse import FakeLangfuse  # noqa: E402

# The traces go to a Langfuse stand-in on loopback, never to a real server, whatever the caller's environment says.
fake = FakeLangfuse("pk-lf-example", "sk-lf-example")
# region snippet-tracing
os.environ["LANGFUSE_PUBLIC_KEY"] = "pk-lf-example"
os.environ["LANGFUSE_SECRET_KEY"] = "sk-lf-example"
os.environ["LANGFUSE_BASE_URL"] = fake.url  # your Langfuse URL, for example https://cloud.langfuse.com
# endregion snippet-tracing
os.environ["LANGFUSE_TRACING_ENABLED"] = "true"
os.environ.pop("LANGFUSE_HOST", None)

import harness  # noqa: E402
from langfuse import get_client  # noqa: E402
from langfuse.openai import OpenAI  # noqa: E402

PROMPT = "Reply with exactly: pong"
TOOL_PROMPT = "What is the weather in Paris? Use the tool."
TOOL = json.loads((SHARED / "get_weather.tool.json").read_text())
TOOL_RESULT = (SHARED / "get_weather.result.json").read_text().strip()


def s1(client, model):
    response = client.chat.completions.create(model=model, messages=[{"role": "user", "content": PROMPT}], max_completion_tokens=1024)
    choice = response.choices[0]
    return {
        "text": choice.message.content or "",
        "finish_reason": choice.finish_reason,
        "usage": response.usage.model_dump(exclude_none=True) if response.usage else None,
    }


def s2(client, model):
    # region snippet-tools
    messages = [{"role": "user", "content": TOOL_PROMPT}]
    first = client.chat.completions.create(model=model, messages=messages, tools=[TOOL], max_completion_tokens=1024)
    call = first.choices[0].message.tool_calls[0]
    # The assistant turn goes back as the SDK typed it, then the result under the same call id.
    messages.append(first.choices[0].message.model_dump(exclude_none=True))
    messages.append({"role": "tool", "tool_call_id": call.id, "content": TOOL_RESULT})
    second = client.chat.completions.create(model=model, messages=messages, tools=[TOOL], max_completion_tokens=1024)
    # endregion snippet-tools
    return {
        "finish_reason": first.choices[0].finish_reason,
        "tool_name": call.function.name,
        "tool_city": json.loads(call.function.arguments).get("city", ""),
        "tool_call_id": call.id,
        "final_text": second.choices[0].message.content or "",
        "final_finish_reason": second.choices[0].finish_reason,
    }


def s3(client, model):
    # region snippet-stream
    stream = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": PROMPT}],
        max_completion_tokens=1024,
        stream=True,
        stream_options={"include_usage": True},
    )
    # endregion snippet-stream
    text, finish, usage = "", None, None
    for chunk in stream:
        if chunk.usage:
            usage = chunk.usage.model_dump(exclude_none=True)
        for choice in chunk.choices:
            text += choice.delta.content or ""
            finish = choice.finish_reason or finish
    return {"text": text, "finish_reason": finish, "usage": usage, "done": True}


TRACE_NAME = "plugboard-traced-call"


def s8(client, model):
    # region snippet-flush
    response = client.chat.completions.create(model=model, messages=[{"role": "user", "content": PROMPT}], max_completion_tokens=1024, name=TRACE_NAME)
    # The SDK exports in the background: send what is queued before the script ends.
    get_client().flush()
    # endregion snippet-flush
    arrived = [span for span in fake.generations() if span["name"] == TRACE_NAME]
    attributes = arrived[0]["attributes"] if len(arrived) == 1 else {}
    usage, sent = (fake.usage_of(arrived[0]) if arrived else {}), response.usage
    output = json.loads(attributes.get("langfuse.observation.output") or "{}")
    return {
        "trace_received": len(arrived) == 1,
        "trace_model_matches": attributes.get("langfuse.observation.model.name") == model,
        "trace_usage_matches": sent is not None and usage.get("prompt_tokens") == sent.prompt_tokens and usage.get("completion_tokens") == sent.completion_tokens,
        "trace_output_matches": bool(output.get("content")) and output.get("content") == response.choices[0].message.content,
    }


def main() -> None:
    # region snippet
    client = OpenAI(base_url=os.environ["PLUGBOARD_BASE_URL"], api_key=os.environ["PLUGBOARD_KEY"], max_retries=0)
    # endregion snippet
    harness.emit_client("langfuse")
    harness.run_all(
        {
            "S1": lambda model: s1(client, model),
            "S2": lambda model: s2(client, model),
            "S3": lambda model: s3(client, model),
            "S8": lambda model: s8(client, model),
        }
    )
    get_client().shutdown()
    fake.close()


if __name__ == "__main__":
    main()
