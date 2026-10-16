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

Run against the fake, as above. The live run is in [Harness runs](#harness-runs-2026-10-16) below.

## Harness runs (2026-10-16)

`examples/haystack/run.py` runs through the examples harness with `haystack-ai` 3.4.0, pinned in `uv.lock`. It covers S1 text through the two-component pipeline, S2 tool round trip, S3 stream and S4 streamed tool call on `fast`, `anthropic/claude-haiku-4-5` and `openai/gpt-5.6-luna#low` (S3 and S4 on `fast`). S5 to S7 and E1/E2 were not run. Haystack sends no stream usage unless asked, so S3 sets `stream_options` through `generation_kwargs` to request the usage chunk.

- Scripted, byte-identical across two runs: [runs/scripted](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/haystack/runs/scripted). Pass.
- Live against the dev server, served build `git describe` v0.41.0-32-g9852300 (main): [runs/live/2026-10-16-9852300](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/haystack/runs/live/2026-10-16-9852300). Pass. `fast` was served by `anthropic/claude-haiku-4-5` (see its REPORT.md).

The copyable pipeline in `example.py`:

<<< @/../examples/haystack/example.py#snippet
