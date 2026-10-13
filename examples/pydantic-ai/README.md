# pydantic-ai

pydantic-ai (`OpenAIChatModel`, the Chat Completions API) against plugboard: plain chat, a tool round trip, streaming text, a streamed tool call, an image, structured output, the model list, and the two error paths. Each scenario is one file you can copy, and the copyable part sits between `# region snippet` markers. Part of the runnable-examples epic [#174](https://github.com/jjjermiah/opencode-plugboard/issues/174).

## What it shows

| File | Scenario | What the snippet does |
| --- | --- | --- |
| `chat.py` | S1 | one agent run, one answer |
| `tools.py` | S2 | `get_weather` as a `tool_plain`; pydantic-ai runs the tool and sends the result back |
| `stream.py` | S3 | `run_stream` with `stream_text(delta=True)` |
| `stream_tools.py` | S4 | `run_stream_events`; the tool call shows as it streams, and the tool runs once it is complete |
| `image.py` | S5 | a red PNG as a `BinaryContent` part (sent as a data URL) |
| `structured.py` | S6 | `output_type=Meal`, a Pydantic model, validated by pydantic-ai |
| `models.py` | S7 | the model list, through the OpenAI client under the provider |
| `wrong_key.py` | E1 | a wrong key (401), as `ModelHTTPError` |
| `unknown_model.py` | E2 | an unknown model (404), as `ModelHTTPError` |

Each file has a `__main__` block, so it runs on its own. `run.py` is the runner the harness starts; it prints results and writes nothing.

## Setup

```sh
cd examples/pydantic-ai
uv sync --frozen
```

The versions are exact pins (`pydantic-ai-slim[openai]==2.55.0`, `openai==3.29.0`, `pydantic==2.14.1`, `httpx==0.28.1`), locked in `uv.lock`. `.python-version` pins Python 3.13, so `uv` runs the same interpreter everywhere, including CI.

## Run one file

```sh
export PLUGBOARD_BASE_URL=http://127.0.0.1:4010/v1   # ends in /v1
export PLUGBOARD_KEY=<your app key>
uv run chat.py
```

The files take an `AsyncOpenAI` client, so a copy of one needs one:

```python
client = AsyncOpenAI(base_url=os.environ["PLUGBOARD_BASE_URL"], api_key=os.environ["PLUGBOARD_KEY"])
```

## Run the whole example

Through the harness, which captures the traffic and writes the run under `runs/`:

```sh
bun examples/_harness/run.ts pydantic-ai --target scripted   # local, no provider
bun examples/_harness/run.ts pydantic-ai --target live       # the isolated server only
```

## Gotchas

- **Use `OpenAIChatModel`.** `OpenAIResponsesModel` calls `/v1/responses`, which plugboard serves ([Responses API](../../docs/responses.md)), but no scenario here covers it.
- **Pass `max_tokens` to `fast`.** It is a reasoning model. The examples set `ModelSettings(max_tokens=1024)` on every model.
- **Each scenario needs its own client.** pydantic-ai runs each call on its own event loop, and a pooled connection cannot cross loops. `run.py` opens and closes one client per scenario inside that loop.
- **Finish reasons are pydantic-ai's names.** A tool-call turn reports `tool_call`; the wire value is `tool_calls`. The example maps it back, so the observation matches the other clients.
- **Streaming usage needs no setup.** pydantic-ai always sends `stream_options.include_usage`. It reads the stream to its end; the SDK consumes the `[DONE]` frame, which the transcript keeps.
- **Structured output in tool mode sends `tool_choice: "required"`** with the single `final_result` tool. The scripted model forces that tool when it gets `required` with one tool, so both runs take the tool path. Claude may answer with text and a `final_result` call in one message; the observation reads the tool call.
- **`PromptedOutput` once returned numbers as strings** on `fast` (2026-10-11 record). pydantic's lax mode coerced them, so the scenario passed. Prefer the default tool mode or `NativeOutput`.
- **Image answers are not always stable.** On `fast`, one identical `BinaryContent` request in the 2026-10-11 record answered "I don't see an image", then passed on a rerun. The check reads for `red`, so a bad answer fails it.
- **pydantic-ai has no list-models call.** S7 uses `provider.client.models.list()`. Each entry carries the extra `plugboard` object, which the SDK keeps as an extra field.
- **Errors are `ModelHTTPError`.** It carries `status_code` and a `body` with the plugboard `code` (`invalid_api_key`, `model_not_found`).

## Known gaps

None in the scripted run: every scenario passes on all three models.

## Live runs

The latest live run is `runs/live/2026-10-13-c97ac66-2`: all 16 rows pass on the three models. `runs/live/2026-10-13-c97ac66` is the first attempt, which failed on a bug in `structured.py` (a text part read before the tool call) and is kept as the record. Both were run against the isolated server at plugboard `c97ac66`, and `REPORT.md` in the first directory says what went wrong.

## Historical record

`runs/live/2026-10-11-3fcedc7/REPORT.md` is the 2026-10-11 run at commit `3fcedc7`, copied without change from the kit's record before the old kit was removed. It predates the harness and this example's code, so its script name refers to a file that no longer exists.
