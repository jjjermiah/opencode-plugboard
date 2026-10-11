"""OpenAI Python SDK vs plugboard: scenarios S1-S7 + error paths.

Run: PLUGBOARD_BASE_URL=http://127.0.0.1:4011/v1 uv run --project compat/py python compat/py/openai_py.py
Prints one line per scenario: `RESULT <id> <model> PASS|FAIL <note>`.
"""
import json
import os
import traceback
from pathlib import Path

import openai
from openai import OpenAI
from pydantic import BaseModel, ConfigDict

BASE = os.environ.get("PLUGBOARD_BASE_URL", "http://127.0.0.1:4010/v1")
KEY = os.environ.get("PLUGBOARD_KEY") or (Path.home() / ".cache/opencode-adapter-dev/.compat-key").read_text().strip()
FIX = Path(__file__).resolve().parent.parent / "fixtures"

FAST, CLAUDE, GPT = "fast", "anthropic/claude-haiku-4-5", "openai/gpt-5.6-luna#low"
client = OpenAI(base_url=BASE, api_key=KEY)

TOOL = json.loads((FIX / "get_weather.tool.json").read_text())
TOOL_RESULT = (FIX / "get_weather.result.json").read_text().strip()
RED = (FIX / "red32.dataurl.txt").read_text().strip()
MEAL = json.loads((FIX / "meal_estimate.json_schema.json").read_text())
WEATHER_PROMPT = "What is the weather in Paris? Use the tool."
MEAL_PROMPT = "Estimate: 2 boiled eggs and a slice of toast."

results = []


def run(sid, model, fn):
    try:
        note = fn(model)
        results.append((sid, model, "PASS", note or ""))
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        results.append((sid, model, "FAIL", f"{type(e).__name__}: {e}"))
    print("RESULT", *results[-1], flush=True)


def s1(model):
    r = client.chat.completions.create(model=model, messages=[{"role": "user", "content": "Reply with exactly: pong"}])
    c = r.choices[0]
    assert r.object == "chat.completion", r.object
    assert c.message.content and "pong" in c.message.content.lower(), c.message.content
    assert c.finish_reason == "stop", c.finish_reason
    u = r.usage
    assert u and u.prompt_tokens is not None and u.completion_tokens is not None and u.total_tokens is not None
    return f"content={c.message.content!r} usage={u.model_dump(exclude_none=True)}"


def s2(model):
    msgs = [{"role": "user", "content": WEATHER_PROMPT}]
    r = client.chat.completions.create(model=model, messages=msgs, tools=[TOOL])
    c = r.choices[0]
    assert c.finish_reason == "tool_calls", f"finish={c.finish_reason} content={c.message.content!r}"
    tcs = c.message.tool_calls
    assert tcs and len(tcs) == 1, tcs
    tc = tcs[0]
    assert tc.type == "function" and tc.function.name == "get_weather" and tc.id, tc
    args = json.loads(tc.function.arguments)
    assert "paris" in args["city"].lower(), args
    msgs.append(c.message.model_dump(exclude_none=True))  # typed message back into history
    msgs.append({"role": "tool", "tool_call_id": tc.id, "content": TOOL_RESULT})
    r2 = client.chat.completions.create(model=model, messages=msgs, tools=[TOOL])
    c2 = r2.choices[0]
    assert c2.finish_reason == "stop", f"finish2={c2.finish_reason}"
    t = (c2.message.content or "").lower()
    assert "18" in t or "cloud" in t, t
    return f"id={tc.id} args={tc.function.arguments} final={c2.message.content!r}"


def s3(model):
    msgs = [{"role": "user", "content": "Reply with exactly: pong"}]
    # plain stream
    text, roles, fins = "", [], []
    n = 0
    for ch in client.chat.completions.create(model=model, messages=msgs, stream=True):
        n += 1
        assert ch.object == "chat.completion.chunk", ch.object
        for choice in ch.choices:
            if choice.delta.role:
                roles.append(choice.delta.role)
            text += choice.delta.content or ""
            if choice.finish_reason:
                fins.append(choice.finish_reason)
    assert "pong" in text.lower(), text
    assert roles[:1] == ["assistant"], roles
    assert fins == ["stop"], fins
    # include_usage
    text2, usage_chunks, last = "", [], None
    for ch in client.chat.completions.create(
        model=model, messages=msgs, stream=True, stream_options={"include_usage": True}
    ):
        last = ch
        if ch.usage:
            usage_chunks.append(ch)
        for choice in ch.choices:
            text2 += choice.delta.content or ""
    assert "pong" in text2.lower(), text2
    assert last is not None and last.usage and last.choices == [], f"last={last}"
    assert len(usage_chunks) == 1
    return f"chunks={n} text={text!r} usage={last.usage.model_dump(exclude_none=True)}"


def s3_helper(model):
    # SDK's high-level stream helper (accumulates chunks into snapshot)
    with client.chat.completions.stream(
        model=model,
        messages=[{"role": "user", "content": "Reply with exactly: pong"}],
        stream_options={"include_usage": True},
    ) as st:
        for _ in st:
            pass
        final = st.get_final_completion()
    assert "pong" in (final.choices[0].message.content or "").lower()
    return f"final={final.choices[0].message.content!r} usage={final.usage.model_dump(exclude_none=True) if final.usage else None}"


def s4(model):
    stream = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": WEATHER_PROMPT}],
        tools=[TOOL],
        stream=True,
        stream_options={"include_usage": True},
    )
    raw = []
    fins = []
    usage = None
    for ch in stream:
        if ch.usage:
            usage = ch.usage
        for choice in ch.choices:
            for d in choice.delta.tool_calls or []:
                raw.append(d.model_dump(exclude_none=True))
            if choice.finish_reason:
                fins.append(choice.finish_reason)
    assert fins == ["tool_calls"], fins
    assert usage is not None
    assert raw and raw[0].get("id") and raw[0]["function"]["name"] == "get_weather" and raw[0]["type"] == "function", raw
    args = "".join(d["function"].get("arguments", "") for d in raw)
    assert "paris" in json.loads(args)["city"].lower(), args
    return f"deltas={raw}"


def s4_helper(model):
    # SDK accumulating helper -> typed tool_calls
    with client.chat.completions.stream(
        model=model,
        messages=[{"role": "user", "content": WEATHER_PROMPT}],
        tools=[TOOL],
        stream_options={"include_usage": True},
    ) as st:
        for _ in st:
            pass
        final = st.get_final_completion()
    m = final.choices[0].message
    assert final.choices[0].finish_reason == "tool_calls", final.choices[0].finish_reason
    assert m.tool_calls and m.tool_calls[0].function.name == "get_weather", m
    assert "paris" in json.loads(m.tool_calls[0].function.arguments)["city"].lower()
    return f"assembled={m.tool_calls[0].model_dump()}"


def s5(model):
    r = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "What color is this image? One word."},
                    {"type": "image_url", "image_url": {"url": RED}},
                ],
            }
        ],
    )
    t = (r.choices[0].message.content or "")
    assert "red" in t.lower(), t
    return f"answer={t!r}"


class Meal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    calories: float
    protein_g: float


def s6_parse(model):
    r = client.beta.chat.completions.parse(
        model=model, messages=[{"role": "user", "content": MEAL_PROMPT}], response_format=Meal
    )
    m = r.choices[0].message
    assert m.refusal is None, m.refusal
    assert isinstance(m.parsed, Meal), (m.parsed, m.content)
    return f"parsed={m.parsed!r} content={m.content!r}"


def s6_parse_top(model):
    r = client.chat.completions.parse(
        model=model, messages=[{"role": "user", "content": MEAL_PROMPT}], response_format=Meal
    )
    assert isinstance(r.choices[0].message.parsed, Meal)
    return f"parsed={r.choices[0].message.parsed!r}"


def s6_raw(model):
    r = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": MEAL_PROMPT}],
        response_format={"type": "json_schema", "json_schema": MEAL},
    )
    c = r.choices[0].message.content
    d = json.loads(c)
    assert set(d) == {"calories", "protein_g"}, d
    assert all(isinstance(d[k], (int, float)) for k in d), d
    return f"content={c!r}"


def s7(_model):
    ms = client.models.list()
    ids = [m.id for m in ms]
    assert FAST in ids, "fast missing"
    assert any(i.startswith("anthropic/claude") for i in ids)
    assert any(i.endswith("#low") for i in ids)
    extra = ms.data[0].model_extra
    dup = len(ids) - len(set(ids))
    return f"count={len(ids)} duplicates={dup} first={ms.data[0].model_dump()} model_extra_keys={list(extra or {})} created0={sum(1 for m in ms if m.created == 0)}"


def s7_retrieve(_model):
    m = client.models.retrieve(FAST)
    return f"retrieve={m.model_dump()}"


def err_401(_model):
    bad = OpenAI(base_url=BASE, api_key="sk-wrong")
    try:
        bad.chat.completions.create(model=FAST, messages=[{"role": "user", "content": "hi"}])
    except openai.AuthenticationError as e:
        return f"status={e.status_code} code={e.code} type={e.type} body={e.body} msg={str(e)!r}"
    raise AssertionError("no AuthenticationError")


def err_404(_model):
    try:
        client.chat.completions.create(model="nope", messages=[{"role": "user", "content": "hi"}])
    except openai.NotFoundError as e:
        return f"status={e.status_code} code={e.code} type={e.type} param={e.param} body={e.body} msg={str(e)!r}"
    raise AssertionError("no NotFoundError")


def err_401_models(_model):
    bad = OpenAI(base_url=BASE, api_key="sk-wrong")
    try:
        bad.models.list()
    except openai.AuthenticationError as e:
        return f"status={e.status_code} code={e.code}"
    raise AssertionError("no AuthenticationError")


def err_stream_404(_model):
    try:
        for _ in client.chat.completions.create(
            model="nope", messages=[{"role": "user", "content": "hi"}], stream=True
        ):
            pass
    except openai.NotFoundError as e:
        return f"status={e.status_code} code={e.code}"
    raise AssertionError("no NotFoundError")


def extras_developer(model):
    r = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "developer", "content": "Answer tersely."},
            {"role": "user", "content": "Reply with exactly: pong"},
        ],
        max_completion_tokens=200,
        reasoning_effort="low",
    )
    return f"content={r.choices[0].message.content!r}"


if __name__ == "__main__":
    print("openai", openai.__version__, "base", BASE)
    only = set(os.environ.get("ONLY", "").split(",")) - {""}

    plan = [
        ("S1", FAST, s1), ("S1", CLAUDE, s1), ("S1", GPT, s1),
        ("S2", FAST, s2), ("S2", CLAUDE, s2), ("S2", GPT, s2),
        ("S3", FAST, s3), ("S3-helper", FAST, s3_helper),
        ("S4", FAST, s4), ("S4-helper", FAST, s4_helper),
        ("S5", FAST, s5), ("S5", CLAUDE, s5), ("S5", GPT, s5),
        ("S6-parse-beta", FAST, s6_parse), ("S6-parse-beta", CLAUDE, s6_parse), ("S6-parse-beta", GPT, s6_parse),
        ("S6-parse-top", FAST, s6_parse_top),
        ("S6-raw", FAST, s6_raw), ("S6-raw", CLAUDE, s6_raw), ("S6-raw", GPT, s6_raw),
        ("S7", "-", s7), ("S7-retrieve", "-", s7_retrieve),
        ("ERR-401", "-", err_401), ("ERR-401-models", "-", err_401_models),
        ("ERR-404", "-", err_404), ("ERR-404-stream", "-", err_stream_404),
        ("EXTRA-developer+reasoning_effort", FAST, extras_developer),
    ]
    for sid, model, fn in plan:
        if only and sid not in only:
            continue
        run(sid, model, fn)
    print("\nSUMMARY")
    for r in results:
        print(f"{r[0]:34} {r[1]:28} {r[2]}")
