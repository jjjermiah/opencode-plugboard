# Haystack

Run 2026-10-12 against the scripted fake plugboard, not the live dev server (nothing listened on `127.0.0.1:4010`): `haystack-ai` 3.3.0, Python 3.12. `text (pipeline): pass`, `stream: pass`, `tool call: pass`, `tool round trip: pass`, via [examples/haystack/example.py](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/haystack). The `OpenAIChatGenerator` signature (`api_base_url`, `api_key=Secret.from_token(...)`, `streaming_callback`, `tools`) matches what ran. The issue's older-generator claim (`OpenAIGenerator` also takes `api_base_url`) was not run and is not repeated here.

Haystack is deepset's framework for RAG and agent pipelines. `OpenAIChatGenerator` takes a base URL and a key, so it calls plugboard's `POST /v1/chat/completions`.

## Plugboard options

```jsonc
"options": {
  "keys": { "haystack": "{env:PLUGBOARD_KEY_HAYSTACK}" },
  "models": ["anthropic/claude-haiku-4-5"],
  "aliases": { "fast": "anthropic/claude-haiku-4-5" }
}
```

Every alias target must also be in `models`.

## Haystack config

```sh
pip install haystack-ai
```

```python
from haystack.components.generators.chat import OpenAIChatGenerator
from haystack.utils import Secret

gen = OpenAIChatGenerator(
    model="fast",
    api_base_url="http://127.0.0.1:4010/v1",
    api_key=Secret.from_token("<your plugboard app key>"),
)
```

Keep `/v1` in `api_base_url`. The full example is a pipeline: a `ChatPromptBuilder` feeds the generator, and the script runs the same pipeline for the text and stream checks. See [examples/haystack/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/haystack).

## Features exercised

- Text through a two-component `Pipeline`.
- Streaming with `streaming_callback`, which received 4 chunks on the fake.
- Tool calling: a `Tool` with a JSON schema goes to the generator, and `ChatMessage.from_tool` carries the result back for the follow-up turn.
- Not run: structured output.

## Quirks

- Unverified: the issue says Haystack reads `OPENAI_API_KEY`, `OPENAI_TIMEOUT` and `OPENAI_MAX_RETRIES` from the environment as fallbacks. This run did not test that. Pass `api_key` explicitly so the plugboard key is the one used.
- `api_key` takes a `Secret`. A plain string does not work; use `Secret.from_token`.
- The tool result must reference the originating call (`origin=`) so the follow-up turn is well formed.

## Verified

Run against the fake, as above. The live dev server was not up, so a live run is still open.
