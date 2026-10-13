# LangChain Python

LangChain (`langchain-openai`'s `ChatOpenAI`) against plugboard: plain chat, a tool round trip, streaming with and without usage, a streamed tool call, an image, structured output, the model list, and the two error paths. Each scenario is one file you can copy, and the copyable part sits between `# region snippet` markers. Part of the runnable-examples epic [#174](https://github.com/jjjermiah/opencode-plugboard/issues/174).

## What it shows

| File | Scenario | What the snippet does |
| --- | --- | --- |
| `llm.py` | all | `chat_model(model)`: the one `ChatOpenAI` every scenario builds |
| `chat.py` | S1 | one `invoke` |
| `tools.py` | S2 | `bind_tools`, the tool call answered with a `ToolMessage` under the same id |
| `stream.py` | S3 | `stream` with `stream_usage`, folded with `+`; and without usage |
| `stream_tools.py` | S4 | streamed tool call, folded into one message with parsed arguments |
| `image.py` | S5 | a red PNG as an `image_url` part, and as LangChain's standard `image` block |
| `structured.py` | S6 | `with_structured_output` with a Pydantic model (`json_schema`, plus `function_calling` and `json_mode` recorded) |
| `models.py` | S7 | the model list, through the wrapped OpenAI client (`root_client`) |
| `errors.py` | E1, E2 | a wrong key (401) and an unknown model (404) |

Each file has a `__main__` block, so it runs on its own. `run.py` is the runner the harness starts; it prints results and writes nothing.

## Setup

```sh
cd examples/langchain-python
uv sync --frozen
```

Exact pins: `langchain-openai==1.7.0`, `langchain-core==1.6.9`, `openai==3.29.0`, `httpx==0.28.1` and `pydantic==2.14.1`, locked in `uv.lock`. `.python-version` pins Python 3.13.

## Run one file

```sh
export PLUGBOARD_BASE_URL=http://127.0.0.1:4010/v1   # ends in /v1
export PLUGBOARD_KEY=<your app key>
uv run chat.py
```

`client` in each file is `chat_model` from `llm.py`; the file's `run(client, model)` is what the runner calls.

## Run the whole example

Through the harness, which captures the traffic and writes the run under `runs/`:

```sh
bun examples/_harness/run.ts langchain-python --target scripted   # local, no provider
bun examples/_harness/run.ts langchain-python --target live       # the isolated server only
```

## Gotchas

- **Set `use_responses_api=False`.** Left unset, a model id that starts with `gpt-5.6` can switch the client to `/v1/responses`. `llm.py` sets it on every call. The 2026-10-11 record hit this in the JS client; the Python client only switches on a prefix.
- **`max_tokens` goes out as `max_completion_tokens`.** LangChain maps the field, so the wire carries `max_completion_tokens: 1024` for `fast`. `fast` is a reasoning model, so the cap is what leaves room for an answer.
- **Usage while streaming needs `stream_usage=True`.** Without it the stream still has the text, and no usage.
- **There is no list-models call in LangChain.** The model list comes from `llm.root_client.models.list()`, the wrapped `openai.OpenAI`.
- **Errors are the OpenAI SDK's.** A wrong key raises `openai.AuthenticationError` (401, `invalid_api_key`); an unknown model raises `openai.NotFoundError` (404, `model_not_found`).
- **Structured output: the json_schema method is the checked one.** `function_calling` and `json_mode` run in the same scenario and their outcome is recorded in the observations, not checked. The 2026-10-11 record saw `json_mode` on `fast` return `{}`. See the record below.
- **Tool call ids are opaque.** Send them back as they came; the run files hold placeholders, so the prefixes do not show.

## Known gaps

None in the scripted run. The live run of 2026-10-13 (`runs/live/2026-10-13-c97ac66`, plugboard `c97ac66`, 0.26.0) passed every scenario on every model, including `openai/gpt-5.6-luna#low`; its `REPORT.md` has the notes.

## Historical record

`runs/live/2026-10-11-3fcedc7/REPORT.md` is the 2026-10-11 run at commit `3fcedc7`, copied from `compat/results/langchain.md` without change. It covers both LangChain clients (Python and JS) and predates the `json_object` change and the usage fix it names.
