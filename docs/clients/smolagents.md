# smolagents

Run 2026-10-12 against the scripted fake plugboard, not the live dev server (nothing listened on `127.0.0.1:4010`): `smolagents` 1.26.0 with the `openai` extra (`openai` 3.29.0), Python 3.12. Via [examples/smolagents/example.py](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/smolagents): `text: pass`, `stream: pass`, `tool call: pass`, `tool round trip: fail` (see Quirks). `OpenAIModel(model_id, api_base, api_key)` matches what ran.

smolagents is Hugging Face's minimal agent library. `OpenAIModel` calls any OpenAI-compatible base URL, so it reaches plugboard's `POST /v1/chat/completions`.

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
)
```

Keep `/v1` in `api_base`. The `LiteLLMModel` form from the issue (`model_id="openai/fast"`, `api_base=...`) was not run.

## Features exercised

- Text: `model.generate(...)`, returns a message whose `content` is the answer.
- Streaming: `model.generate_stream(...)`, which yielded 2 deltas on the fake.
- A tool-calling agent: `ToolCallingAgent` with one `@tool`, calling `get_weather` on the fake.
- Not run: code agents, which need generated Python to execute, and `LiteLLMModel`.

## Quirks

- **`pip install smolagents` alone is not enough for `OpenAIModel`.** It raises `ModuleNotFoundError: Please install 'openai' extra`. Install `smolagents[openai]`.
- **Tool round trip failed on the fake.** smolagents' default conversion sends the tool result as a `user` message with the observation, not as a `tool`-role message. The fake's scripted reply answers only after a `tool`-role result, so it kept calling the tool until the agent hit `max_steps`. This is a fake limit, not a plugboard fault; a live model that reads the observation should answer. Not verified live.
- Forcing a `tool` role with `custom_role_conversions={"tool-response": "tool", "tool-call": "assistant"}` fails: smolagents does not send `tool_call_id`, and plugboard returns 400 `Tool messages need a tool_call_id`, the same rule OpenAI enforces. Keep the default conversion for this client.
- Some reasoning models reject `stop`; smolagents strips it for known ids, which the issue states and this run did not test.

## Verified

Run against the fake, as above. The live dev server was not up, so the round trip on a real model is still open.
