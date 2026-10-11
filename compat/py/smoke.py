"""S1 smoke: plain chat against `fast` through the OpenAI Python SDK.

Run: cd compat/py && PLUGBOARD_KEY=... uv run smoke.py
Env: PLUGBOARD_BASE_URL (default http://127.0.0.1:4010/v1), PLUGBOARD_KEY (required).
"""
import os

import openai
from openai import OpenAI

BASE = os.environ.get("PLUGBOARD_BASE_URL", "http://127.0.0.1:4010/v1")
KEY = os.environ["PLUGBOARD_KEY"]

client = OpenAI(base_url=BASE, api_key=KEY)
r = client.chat.completions.create(model="fast", messages=[{"role": "user", "content": "Reply with exactly: pong"}])
content = r.choices[0].message.content or ""
print("openai", openai.__version__, "| model:", r.model, "| finish:", r.choices[0].finish_reason)
print("content:", repr(content), "| usage:", r.usage)
assert "pong" in content.lower(), f"expected pong, got {content!r}"
assert r.choices[0].finish_reason == "stop", r.choices[0].finish_reason
print("S1 OK")
