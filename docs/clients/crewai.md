# CrewAI

CrewAI's `LLM` class on its OpenAI path.

## Connect

```python
from crewai import LLM

llm = LLM(
    model="openai/fast",
    base_url="http://127.0.0.1:4010/v1",
    api_key=os.environ["PLUGBOARD_KEY"],
)
```

`openai/` picks CrewAI's OpenAI path; the rest (`fast`) is your plugboard alias or model. `base_url` replaces the default whole, so include `/v1`; it wins over `OPENAI_BASE_URL`.

A script with a text reply, a stream and a crew task that calls a tool is in [examples/crewai/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/crewai):

```sh
cd examples/crewai
PLUGBOARD_KEY=<app key> uv run crew.py
```

## What works

Text, streaming (`stream=True` with an `LLMStreamChunkEvent` listener), `@tool` functions in a crew, and structured output with `response_format`.

## Limits

- A crew makes several model calls per task. Set the app's rate limit with that in mind.
- Set `max_completion_tokens` high enough (the example uses 1024) when the model reasons.
