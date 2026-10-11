"""LangChain (langchain-openai) compat run against plugboard. Run: cd compat/py && uv run python langchain_py.py [S1 S2 ...]"""
import json
import os
import sys
import traceback
from pathlib import Path

import httpx
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from pydantic import BaseModel

BASE = os.environ.get("PLUGBOARD_BASE_URL", "http://127.0.0.1:4010/v1")
KEY = os.environ["PLUGBOARD_KEY"]
FIX = Path(__file__).resolve().parents[1] / "fixtures"
FAST, CLAUDE, GPT = "fast", "anthropic/claude-haiku-4-5", "openai/gpt-5.6-luna#low"
RED = (FIX / "red32.dataurl.txt").read_text().strip()
TOOL_RESULT = (FIX / "get_weather.result.json").read_text().strip()
PW = "What is the weather in Paris? Use the tool."


def llm(model, **kw):
    return ChatOpenAI(base_url=BASE, api_key=KEY, model=model, use_responses_api=False, **kw)


@tool
def get_weather(city: str) -> str:
    """Get the current weather for a city."""
    return TOOL_RESULT


class Meal(BaseModel):
    """Meal nutrition estimate."""
    calories: float
    protein_g: float


def show(msg):
    print("  content:", repr(msg.content)[:200])
    print("  tool_calls:", msg.tool_calls)
    print("  usage_metadata:", msg.usage_metadata)
    print("  response_metadata:", {k: v for k, v in msg.response_metadata.items()})


def s1(model=FAST):
    m = llm(model).invoke("Reply with exactly: pong")
    show(m)
    assert "pong" in m.content.lower(), "no pong"
    assert m.response_metadata.get("finish_reason") == "stop"
    assert m.usage_metadata and m.usage_metadata["total_tokens"]


def s2(model=FAST):
    b = llm(model).bind_tools([get_weather])
    hist = [HumanMessage(PW)]
    m = b.invoke(hist)
    show(m)
    assert m.response_metadata.get("finish_reason") == "tool_calls", m.response_metadata
    assert len(m.tool_calls) == 1 and m.tool_calls[0]["name"] == "get_weather" and m.tool_calls[0]["id"]
    assert "paris" in json.dumps(m.tool_calls[0]["args"]).lower()
    hist += [m, ToolMessage(content=TOOL_RESULT, tool_call_id=m.tool_calls[0]["id"])]
    m2 = b.invoke(hist)
    print(" turn2:")
    show(m2)
    assert m2.response_metadata.get("finish_reason") == "stop"
    assert "18" in m2.content or "cloudy" in m2.content.lower()


def s3(model=FAST):
    chunks = list(llm(model, stream_usage=True).stream("Reply with exactly: pong"))
    text = "".join(c.content for c in chunks)
    print("  n chunks:", len(chunks), "text:", repr(text))
    last = chunks[-1]
    agg = chunks[0]
    for c in chunks[1:]:
        agg = agg + c
    print("  aggregated usage_metadata:", agg.usage_metadata)
    print("  aggregated response_metadata:", agg.response_metadata)
    print("  usage chunks:", [c.usage_metadata for c in chunks if c.usage_metadata])
    assert "pong" in text.lower()
    assert agg.response_metadata.get("finish_reason") == "stop"
    assert agg.usage_metadata and agg.usage_metadata["total_tokens"]
    # without usage
    chunks2 = list(llm(model, stream_usage=False).stream("Reply with exactly: pong"))
    print("  (stream_usage=False) text:", repr("".join(c.content for c in chunks2)))


def s4(model=FAST):
    b = llm(model, stream_usage=True).bind_tools([get_weather])
    chunks = list(b.stream(PW))
    agg = chunks[0]
    for c in chunks[1:]:
        agg = agg + c
    for i, c in enumerate(chunks):
        if c.tool_call_chunks:
            print("  chunk", i, "tool_call_chunks:", c.tool_call_chunks)
    print("  aggregated tool_calls:", agg.tool_calls, "invalid:", agg.invalid_tool_calls)
    print("  usage:", agg.usage_metadata, "| response_metadata:", agg.response_metadata)
    assert len(agg.tool_calls) == 1 and agg.tool_calls[0]["name"] == "get_weather"
    assert "paris" in json.dumps(agg.tool_calls[0]["args"]).lower()
    assert agg.response_metadata.get("finish_reason") == "tool_calls"
    # feed back (stream)
    hist = [HumanMessage(PW), agg, ToolMessage(content=TOOL_RESULT, tool_call_id=agg.tool_calls[0]["id"])]
    m2 = b.invoke(hist)
    print(" turn2 (from streamed AIMessageChunk):")
    show(m2)


def s5(model=FAST):
    msg = HumanMessage(content=[
        {"type": "text", "text": "What color is this image? One word."},
        {"type": "image_url", "image_url": {"url": RED}},
    ])
    m = llm(model).invoke([msg])
    show(m)
    assert "red" in m.content.lower()
    # new standard block format
    msg2 = HumanMessage(content=[
        {"type": "text", "text": "What color is this image? One word."},
        {"type": "image", "base64": RED.split(",", 1)[1], "mime_type": "image/png"},
    ])
    m = llm(model).invoke([msg2])
    print(" standard image block:")
    show(m)
    assert "red" in m.content.lower()


def s6(model=FAST):
    prompt = "Estimate: 2 boiled eggs and a slice of toast."
    failed = []
    for method in ("json_schema", "function_calling", "json_mode"):
        print(f" method={method}")
        try:
            p = prompt + (" Respond as JSON with keys calories and protein_g (numbers)." if method == "json_mode" else "")
            kw = {"include_raw": True}
            r = llm(model).with_structured_output(Meal, method=method, **kw).invoke(p)
            print("  raw content:", repr(r["raw"].content)[:200], "tool_calls:", r["raw"].tool_calls)
            print("  parsed:", r["parsed"], "| parsing_error:", r["parsing_error"])
            assert isinstance(r["parsed"], Meal), "not parsed"
            print("  OK")
        except Exception as e:
            print("  FAIL", type(e).__name__, str(e)[:600])
            failed.append(method)
    if failed:
        raise AssertionError(f"structured output failed for: {', '.join(failed)}")


def s7():
    c = llm(FAST).root_client  # openai.OpenAI
    ids = [m.id for m in c.models.list()]
    print("  count:", len(ids), "dups:", len(ids) - len(set(ids)))
    assert FAST in ids and CLAUDE in ids and GPT in ids
    # raw httpx for extra field
    r = httpx.get(BASE + "/models", headers={"Authorization": f"Bearer {KEY}"})
    print("  raw status:", r.status_code)


def err():
    try:
        ChatOpenAI(base_url=BASE, api_key="bad", model=FAST, use_responses_api=False, max_retries=0).invoke("hi")
    except Exception as e:
        print("  bad key:", type(e).__name__, str(e)[:300])
    else:
        raise AssertionError("bad key was accepted")
    try:
        llm("nope", max_retries=0).invoke("hi")
    except Exception as e:
        print("  bad model:", type(e).__name__, str(e)[:300])
    else:
        raise AssertionError("unknown model was accepted")


def defaults():
    llm(FAST)  # noqa
    import langchain_openai, langchain_core, openai
    print("  versions:", langchain_openai.__name__, openai.__version__)
    print("  use_responses_api default (no arg):", ChatOpenAI(base_url=BASE, api_key=KEY, model=FAST)._use_responses_api({}))


RUNS = {
    "S1": [("S1", s1, FAST)],
    "S2": [("S2", s2, FAST), ("S2", s2, CLAUDE), ("S2", s2, GPT)],
    "S3": [("S3", s3, FAST)],
    "S4": [("S4", s4, FAST)],
    "S5": [("S5", s5, FAST), ("S5", s5, CLAUDE), ("S5", s5, GPT)],
    "S6": [("S6", s6, FAST), ("S6", s6, CLAUDE), ("S6", s6, GPT)],
    "S7": [("S7", s7, None)],
    "S1x": [("S1", s1, CLAUDE), ("S1", s1, GPT)],
    "ERR": [("ERR", err, None)],
    "DEF": [("DEF", defaults, None)],
}

if __name__ == "__main__":
    want = sys.argv[1:] or list(RUNS)
    failures = []
    for k in want:
        for name, fn, model in RUNS[k]:
            print(f"== {name} model={model}")
            try:
                fn(model) if model else fn()
                print("  -> PASS")
            except Exception:
                print("  -> FAIL")
                traceback.print_exc(limit=3)
                failures.append(f"{name} {model or '-'}")
    print(f"\nSUMMARY: {len(failures)} failed")
    for f in failures:
        print("  FAIL", f)
    sys.exit(1 if failures else 0)
