"""pydantic-ai compat check against plugboard (S1..S7 + error paths).

Run: cd compat/py && uv run python pydantic_ai_check.py [--base URL] [--only S1,S2] [--models fast,...]
Env: PLUGBOARD_BASE_URL (default http://127.0.0.1:4010/v1), PLUGBOARD_KEY (required).
"""
import argparse
import asyncio
import base64
import os
import sys
import traceback
from pathlib import Path

from pydantic import BaseModel
from pydantic_ai import Agent, BinaryContent, ImageUrl, NativeOutput, PromptedOutput
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    PartDeltaEvent,
    PartStartEvent,
)
from pydantic_ai.models.openai import OpenAIChatModel, OpenAIChatModelSettings
from pydantic_ai.providers.openai import OpenAIProvider

FIX = Path(__file__).resolve().parents[1] / "fixtures"
KEY = os.environ["PLUGBOARD_KEY"]

FAST = "fast"
CLAUDE = "anthropic/claude-haiku-4-5"
GPT = "openai/gpt-5.6-luna#low"

RESULTS: list[tuple[str, str, str, str]] = []


class Meal(BaseModel):
    calories: float
    protein_g: float


def model_for(name: str, base: str, key: str = KEY) -> OpenAIChatModel:
    return OpenAIChatModel(name, provider=OpenAIProvider(base_url=base, api_key=key))


def record(scn: str, model: str, ok: bool, note: str):
    RESULTS.append((scn, model, "pass" if ok else "FAIL", note))
    print(f"[{scn}] {model}: {'pass' if ok else 'FAIL'} :: {note}", flush=True)


async def guard(scn, model, coro):
    try:
        ok, note = await coro
        record(scn, model, ok, note)
    except Exception as e:  # noqa: BLE001
        tb = traceback.format_exc(limit=3)
        record(scn, model, False, f"{type(e).__name__}: {e!s}"[:1500])
        print(tb, file=sys.stderr, flush=True)


def usage_str(u):
    return f"in={u.input_tokens} out={u.output_tokens} total={u.total_tokens} reqs={u.requests}"


async def s1(m, base):
    agent = Agent(model_for(m, base))
    r = await agent.run("Reply with exactly: pong")
    return "pong" in r.output.lower(), f"output={r.output!r} {usage_str(r.usage)}"


async def s2(m, base):
    agent = Agent(model_for(m, base))
    calls = []

    @agent.tool_plain
    def get_weather(city: str) -> dict:
        """Get the current weather for a city."""
        calls.append(city)
        return {"temp_c": 18, "sky": "cloudy"}

    r = await agent.run("What is the weather in Paris? Use the tool.")
    out = r.output
    ok = bool(calls) and ("18" in out or "cloud" in out.lower()) and "paris" in calls[0].lower()
    return ok, f"calls={calls} output={out!r} {usage_str(r.usage)}"


async def s3(m, base):
    agent = Agent(model_for(m, base))
    chunks = []
    async with agent.run_stream("Reply with exactly: pong") as res:
        async for t in res.stream_text(delta=True):
            chunks.append(t)
        final = await res.get_output()
        u = res.usage
    ok = "pong" in "".join(chunks).lower() and "pong" in final.lower()
    return ok, f"deltas={chunks!r} final={final!r} {usage_str(u)}"


async def s3_stream_events(m, base):
    agent = Agent(model_for(m, base))
    kinds = []
    async with agent.run_stream_events("Reply with exactly: pong") as stream:
        async for ev in stream:
            kinds.append(type(ev).__name__)
    return kinds[-1] == "AgentRunResultEvent", f"events={kinds}"


async def s4(m, base):
    agent = Agent(model_for(m, base))
    calls = []

    @agent.tool_plain
    def get_weather(city: str) -> dict:
        """Get the current weather for a city."""
        calls.append(city)
        return {"temp_c": 18, "sky": "cloudy"}

    kinds = []
    tool_starts = []
    final = None
    async with agent.run_stream_events("What is the weather in Paris? Use the tool.") as stream:
        async for ev in stream:
            kinds.append(type(ev).__name__)
            if isinstance(ev, PartStartEvent) and type(ev.part).__name__ == "ToolCallPart":
                tool_starts.append((ev.part.tool_name, ev.part.tool_call_id, ev.part.args))
            if isinstance(ev, FunctionToolCallEvent):
                tool_starts.append(("exec", ev.part.tool_name, ev.part.args))
            if type(ev).__name__ == "AgentRunResultEvent":
                final = ev.result.output
    ok = bool(calls) and "paris" in calls[0].lower() and final is not None
    return ok, f"calls={calls} tool_events={tool_starts} final={final!r} kinds={sorted(set(kinds))}"


async def s4_run_stream(m, base):
    """run_stream (non-events API) with a tool: tool runs, then text stream."""
    agent = Agent(model_for(m, base))
    calls = []

    @agent.tool_plain
    def get_weather(city: str) -> dict:
        """Get the current weather for a city."""
        calls.append(city)
        return {"temp_c": 18, "sky": "cloudy"}

    async with agent.run_stream("What is the weather in Paris? Use the tool.") as res:
        txt = "".join([t async for t in res.stream_text(delta=True)])
    return bool(calls), f"calls={calls} text={txt!r}"


async def s5_binary(m, base):
    png = (FIX / "red32.png").read_bytes()
    agent = Agent(model_for(m, base))
    r = await agent.run(["What color is this image? One word.", BinaryContent(data=png, media_type="image/png")])
    return "red" in r.output.lower(), f"BinaryContent output={r.output!r}"


async def s5_url(m, base):
    url = (FIX / "red32.dataurl.txt").read_text().strip()
    agent = Agent(model_for(m, base))
    r = await agent.run(["What color is this image? One word.", ImageUrl(url=url)])
    return "red" in r.output.lower(), f"ImageUrl(data:) output={r.output!r}"


async def s6_tool(m, base):
    agent = Agent(model_for(m, base), output_type=Meal)
    r = await agent.run("Estimate: 2 boiled eggs and a slice of toast.")
    return isinstance(r.output, Meal), f"tool-mode output={r.output!r} {usage_str(r.usage)}"


async def s6_native(m, base):
    agent = Agent(model_for(m, base), output_type=NativeOutput(Meal))
    r = await agent.run("Estimate: 2 boiled eggs and a slice of toast.")
    return isinstance(r.output, Meal), f"native output={r.output!r}"


async def s6_prompted(m, base):
    agent = Agent(model_for(m, base), output_type=PromptedOutput(Meal))
    r = await agent.run("Estimate: 2 boiled eggs and a slice of toast.")
    return isinstance(r.output, Meal), f"prompted output={r.output!r}"


async def s7(base):
    prov = OpenAIProvider(base_url=base, api_key=KEY)
    page = await prov.client.models.list()
    ids = [x.id for x in page.data]
    from collections import Counter

    dups = sum(1 for _, c in Counter(ids).items() if c > 1)
    ok = "fast" in ids and any("claude" in i for i in ids) and any(i.endswith("#low") for i in ids)
    return ok, f"n={len(ids)} dup_ids={dups} fast={'fast' in ids}"


async def sys_prompt_effort(m, base):
    """system_prompt + openai_reasoning_effort: observe roles/fields in traffic."""
    agent = Agent(
        model_for(m, base),
        system_prompt="You are terse.",
        model_settings=OpenAIChatModelSettings(openai_reasoning_effort="low", max_tokens=400),
    )
    r = await agent.run("Reply with exactly: pong")
    return "pong" in r.output.lower(), f"output={r.output!r}"


async def err_wrong_key(base):
    agent = Agent(model_for(FAST, base, key="wrong-key"))
    try:
        await agent.run("hi")
    except Exception as e:  # noqa: BLE001
        return type(e).__name__ in ("ModelHTTPError",), f"{type(e).__name__}: {e!s}"[:600]
    return False, "no error"


async def err_bad_model(base):
    agent = Agent(model_for("nope", base))
    try:
        await agent.run("hi")
    except Exception as e:  # noqa: BLE001
        return type(e).__name__ == "ModelHTTPError", f"{type(e).__name__}: {e!s}"[:600]
    return False, "no error"


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=os.environ.get("PLUGBOARD_BASE_URL", "http://127.0.0.1:4010/v1"))
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    base = a.base
    only = set(filter(None, a.only.split(",")))
    want = lambda k: not only or k in only  # noqa: E731

    if want("S1"):
        for m in (FAST, CLAUDE, GPT):
            await guard("S1", m, s1(m, base))
    if want("S2"):
        for m in (FAST, CLAUDE, GPT):
            await guard("S2", m, s2(m, base))
    if want("S3"):
        await guard("S3", FAST, s3(FAST, base))
        await guard("S3-events", FAST, s3_stream_events(FAST, base))
    if want("S4"):
        await guard("S4", FAST, s4(FAST, base))
        await guard("S4-run_stream", FAST, s4_run_stream(FAST, base))
    if want("S5"):
        for m in (FAST, CLAUDE, GPT):
            await guard("S5-binary", m, s5_binary(m, base))
            await guard("S5-dataurl", m, s5_url(m, base))
    if want("S6"):
        for m in (FAST, CLAUDE, GPT):
            await guard("S6-tool", m, s6_tool(m, base))
            await guard("S6-native", m, s6_native(m, base))
            await guard("S6-prompted", m, s6_prompted(m, base))
    if want("S7"):
        await guard("S7", "n/a", s7(base))
    if want("X"):
        await guard("X-sysprompt-effort", FAST, sys_prompt_effort(FAST, base))
        await guard("X-wrong-key", FAST, err_wrong_key(base))
        await guard("X-bad-model", "nope", err_bad_model(base))

    print("\n=== SUMMARY ===")
    for r in RESULTS:
        print(" | ".join(r)[:200])
    failed = [r for r in RESULTS if r[2] != "pass"]
    print(f"{len(failed)} of {len(RESULTS)} failed")
    return 1 if failed else 0


sys.exit(asyncio.run(main()))
