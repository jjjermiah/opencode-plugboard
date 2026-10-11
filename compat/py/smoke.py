"""S1 smoke: plain chat against `fast` through the OpenAI Python SDK. Run: cd compat/py && uv run smoke.py"""
import os
from pathlib import Path

from openai import OpenAI

BASE = os.environ.get("PLUGBOARD_BASE_URL", "http://127.0.0.1:4010/v1")
KEY = os.environ.get("PLUGBOARD_KEY") or (Path.home() / ".cache/opencode-adapter-dev/.compat-key").read_text().strip()

client = OpenAI(base_url=BASE, api_key=KEY)
r = client.chat.completions.create(model="fast", messages=[{"role": "user", "content": "Reply with exactly: pong"}])
print("openai", __import__("openai").__version__, "| model:", r.model, "| finish:", r.choices[0].finish_reason)
print("content:", repr(r.choices[0].message.content), "| usage:", r.usage)
assert r.choices[0].message.content and r.choices[0].finish_reason == "stop"
print("S1 OK")
