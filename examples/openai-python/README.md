# OpenAI Python SDK

The OpenAI Python SDK against plugboard: plain chat, a tool round trip, streaming (raw and through the SDK's helper), streaming tool calls, an image, structured output, the model list, and the two error paths. Each scenario is one file you can copy, and the copyable part sits between `# region snippet` markers. Part of the runnable-examples epic [#174](https://github.com/jjjermiah/opencode-plugboard/issues/174).

## What it shows

| File | Scenario | What the snippet does |
| --- | --- | --- |
| `chat.py` | S1 | one non-streamed chat call |
| `tools.py` | S2 | `get_weather` call, the assistant turn sent back, the tool result under the same id |
| `stream.py` | S3 | raw stream with `include_usage`, and the stream helper that must agree with it |
| `stream_tools.py` | S4 | streamed tool call, arguments accumulated across deltas |
| `image.py` | S5 | a red PNG as a data URL in a multi-part message |
| `structured.py` | S6 | `beta.chat.completions.parse` with a Pydantic model, `chat.completions.parse`, and the raw `json_schema` form |
| `models.py` | S7 | `models.list()` and `models.retrieve("fast")` |
| `wrong_key.py` | E1 | a wrong key (401) |
| `unknown_model.py` | E2 | an unknown model (404) |

Each file has a `__main__` block, so it runs on its own. `run.py` is the runner the harness starts; it prints results and writes nothing.

## Setup

```sh
cd examples/openai-python
uv sync --frozen
```

The versions are exact pins (`openai==3.29.0`, `pydantic==2.14.1`, `httpx==0.28.1`), locked in `uv.lock`. `.python-version` pins Python 3.13, so `uv` runs the same interpreter everywhere, including CI.

## Run one file

```sh
export PLUGBOARD_BASE_URL=http://127.0.0.1:4010/v1   # ends in /v1
export PLUGBOARD_KEY=<your app key>
uv run chat.py
```

## Run the whole example

Through the harness, which captures the traffic and writes the run under `runs/`:

```sh
bun examples/_harness/run.ts openai-python --target scripted   # local, no provider
bun examples/_harness/run.ts openai-python --target live       # the isolated server only
```

## Gotchas

- **Tool call ids differ by model.** The 2026-10-11 record saw a bare UUID on `fast`, `toolu_...` on Claude and `call_...` on the ChatGPT id (the run files hold placeholders, so this run cannot show the prefixes). Don't parse them; send them back as they came.
- **Streaming usage needs `stream_options={"include_usage": True}`.** A streamed tool call arrives as one delta with the whole arguments string. `stream_tools.py` still accumulates, because a client has to handle both.
- **`parse` sends `"stream": false`.** Pydantic adds `title` keys to the schema; every model tested accepts them.
- **Structured output is a forced tool.** Plugboard asks the model to answer through a `respond` tool, and the provider does not enforce the schema. The checks read the numbers, not the form.
- **`models.retrieve` was a 404 in the 2026-10-11 record.** It is implemented now and passes live (S7). The old record stays in `runs/live/2026-10-11-3fcedc7/REPORT.md`, unchanged.
- **`fast` returned a reasoning sample once.** One streamed reply on `fast` in the old record read `User wants exactly "pong".pong`. It has not reproduced; the check reads for `pong`, so it passes either way.
- **A wrong key raises `AuthenticationError`** (401 `invalid_api_key`); an unknown model raises `NotFoundError` (404 `model_not_found`). The runner sets `max_retries=0`, so a retry never shows up as a second request.
- **`model_extra` has the `plugboard` object.** Each entry from `models.list()` carries it; the SDK keeps it as an extra field, not an error.

## Known gaps

None. Both targets pass every scenario.

## Historical record

`runs/live/2026-10-11-3fcedc7/REPORT.md` is the 2026-10-11 run at commit `3fcedc7`, copied from `compat/results/openai-python.md` without change. It predates the `models.retrieve` fix.
