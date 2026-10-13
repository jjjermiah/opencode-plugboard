# smolagents

Verified: run, 2026-10-13. [examples/smolagents](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/smolagents) (smolagents 1.26.0 with the `openai` extra, `openai` 3.29.0, Python 3.12, run with `uv run`) ran live against plugboard with model `fast`: `text`, `stream`, `tool call` and `tool round trip` all passed. Earlier, on the scripted fake, the round trip failed; that was a fake limit, see Quirks. Not in `docs/compatibility.md` yet: there is no scripted test for it.

smolagents is Hugging Face's minimal agent library. `OpenAIModel` calls any OpenAI-compatible base URL, so it reaches plugboard's `POST /v1/chat/completions`. The config was checked against the smolagents models reference, <https://huggingface.co/docs/smolagents/reference/models>.

## Plugboard options

```jsonc
"options": {
  "keys": { "smolagents": "{env:PLUGBOARD_KEY_SMOLAGENTS}" },
  "models": ["anthropic/claude-haiku-4-5"],
  "aliases": { "fast": "anthropic/claude-haiku-4-5" }
}
```

Every alias target must also be in `models`.

## smolagents config

```sh
pip install 'smolagents[openai]'
```

```python
from smolagents import OpenAIModel

model = OpenAIModel(
    model_id="fast",
    api_base="http://127.0.0.1:4010/v1",
    api_key="<your plugboard app key>",
    max_completion_tokens=1024,
)
```

- Keep `/v1` in `api_base`.
- `api_key` is a plugboard app key. smolagents requires a non-empty value even for a local endpoint.
- `max_completion_tokens` is passed through to the chat call, so the reasoning model behind `fast` has room to answer.

The `LiteLLMModel` form (`model_id="openai/fast"`) was not run.

## What the example does

`example.py` makes four checks:

1. A text reply through `model.generate`.
2. A streamed reply through `model.generate_stream`.
3. A `ToolCallingAgent` with one `@tool` function, `get_weather`. The script checks that the tool was called.
4. The agent's final answer uses the tool result.

Run it:

```sh
cd examples/smolagents
PLUGBOARD_KEY=<app key> uv run example.py
```

`uv` reads the dependency from the script header (`smolagents[openai]`), so there is no venv to create.

## Features exercised

- Text: `model.generate(...)`, which returns a message whose `content` is the answer.
- Streaming: `model.generate_stream(...)`. On `fast` it yielded one delta with content.
- A tool-calling agent: `ToolCallingAgent`, two steps (tool call, then `final_answer`).

Not exercised: code agents, which run generated Python, and `LiteLLMModel`.

## Quirks

- **`pip install smolagents` alone is not enough for `OpenAIModel`.** It raises `ModuleNotFoundError: Please install 'openai' extra`. Install `smolagents[openai]`.
- **The streamed reply came back as a single delta** on `fast`, not several. The check only needs content, so the script does not count deltas.
- **Earlier round-trip failure was the fake.** On the scripted fake, the scripted reply only answered after a `tool`-role result, and smolagents sends the observation as a `user` message, so the agent ran until `max_steps`. On the live `fast` model the round trip passes with the default conversion.
- **Forcing a `tool` role fails.** `custom_role_conversions={"tool-response": "tool", "tool-call": "assistant"}` was tried on the fake: smolagents does not send `tool_call_id`, and plugboard returns 400 `Tool messages need a tool_call_id`, the same rule OpenAI enforces. Keep the default conversion.
- Some reasoning models reject `stop`; smolagents strips it for known ids. Not tested.

## Verified

- Live, 2026-10-13: `text: pass`, `stream: pass`, `tool call: pass`, `tool round trip: pass`, exit 0.
- Not run: `LiteLLMModel`, code agents, a scripted automated check in `test/compat`.
