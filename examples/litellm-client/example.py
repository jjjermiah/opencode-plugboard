# /// script
# requires-python = ">=3.12"
# dependencies = ["litellm==1.105.0"]
# ///
"""LiteLLM as a client on plugboard (#227): one completion, then the same call streamed.

    PLUGBOARD_URL=http://127.0.0.1:4010 PLUGBOARD_KEY=<app key> uv run example.py
"""

import os

os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")  # use the bundled price map; no fetch on import

import litellm  # noqa: E402

litellm.telemetry = False
kwargs = {
    "model": "openai/fast",  # the openai/ prefix selects Chat Completions
    "api_base": f"{os.environ.get('PLUGBOARD_URL', 'http://127.0.0.1:4010').rstrip('/')}/v1",
    "api_key": os.environ["PLUGBOARD_KEY"],
    "messages": [{"role": "user", "content": "Reply with exactly: pong"}],
}

print(litellm.completion(**kwargs).choices[0].message.content)
for chunk in litellm.completion(stream=True, **kwargs):
    print(chunk.choices[0].delta.content or "", end="")
print()
