# CrewAI

Verified: run, 2026-10-13. `examples/crewai` (crewai 1.15.27, Python 3.12, run with `uv run`) ran against plugboard with model `fast`: a text call, a stream and a crew task that called one tool all passed. The config was checked against the CrewAI LLM docs, <https://docs.crewai.com/en/concepts/llms> (the OpenAI section and the streaming section). Not in `docs/compatibility.md` yet: there is no scripted test for it.

CrewAI is a multi-agent framework, not an OpenAI SDK. It is not an official OpenAI library. A crew runs agents and tasks, and each agent calls a model through CrewAI's `LLM` class.

## Plugboard config

```python
from crewai import LLM

llm = LLM(
    model="openai/fast",
    base_url="http://127.0.0.1:4010/v1",
    api_key="<app key>",
)
```

- `openai/` selects CrewAI's native OpenAI path. The model after the slash is the plugboard alias `fast`.
- `base_url` replaces the default `https://api.openai.com/v1` whole, so include `/v1`. The per-`LLM` value wins over the `OPENAI_BASE_URL` environment variable.
- `api_key` is a plugboard app key, not an OpenAI key. CrewAI requires a non-empty value.

A copyable script is in [examples/crewai/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/crewai).

## What the example does

`crew.py` makes three calls:

1. A text reply through `llm.call`.
2. A streamed reply: an `LLM` with `stream=True`, with an `LLMStreamChunkEvent` listener counting chunks.
3. A one-agent crew whose task must call a `get_weather` tool. The script fails if the tool was not called.

Run it:

```sh
cd examples/crewai
PLUGBOARD_KEY=<app key> uv run crew.py
```

`uv` reads the dependency pin from the script header, so there is no venv to create.

## Features exercised

- `LLM` with `base_url` and `api_key` on the OpenAI path.
- Streaming through `stream=True` and `LLMStreamChunkEvent`.
- A `@tool` function attached to an `Agent`, called from a `Crew` `kickoff`.

Not exercised: structured output (`response_format` with a Pydantic model), the Responses API (`api="responses"`), and the Anthropic path (`custom_openai=True` with an Anthropic model id). The last one is the route #231 describes for an Anthropic-shaped gateway; it was not run here.

## Quirks

- CrewAI's event listener reported one non-empty stream chunk for the streamed reply, while the server sent three SSE `data:` events. The chunk count is what CrewAI emits, not a server limit; the script does not check it.
- A crew makes several model calls per task. Check the app's rate limit before running a larger crew.
- The example sets `max_completion_tokens` to 1024, so a reasoning model behind the `fast` alias still has room to answer.
