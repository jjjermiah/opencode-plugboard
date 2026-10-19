# CrewAI

CrewAI's `LLM` class on its OpenAI path.

## Connect

`MODEL` is `"openai/fast"`, `BASE` is `http://127.0.0.1:4010/v1` and `KEY` is your plugboard key.

<<< @/../examples/crewai/crew.py#snippet

`openai/` picks CrewAI's OpenAI path; the rest (`fast`) is your plugboard alias or model. `base_url` replaces the default whole, so include `/v1`; it wins over `OPENAI_BASE_URL`.

To stream, pass `stream=True` and listen for the chunks:

<<< @/../examples/crewai/crew.py#snippet-stream

A tool is a `@tool` function, used by an agent in a crew task:

<<< @/../examples/crewai/crew.py#snippet-tool

<<< @/../examples/crewai/crew.py#snippet-crew

The script with a text reply, a stream and this crew task is in [examples/crewai/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/crewai):

```sh
cd examples/crewai
PLUGBOARD_KEY=<app key> uv run crew.py
```

## What works

Text, streaming (`stream=True` with an `LLMStreamChunkEvent` listener), `@tool` functions in a crew, and structured output with `response_format`.

## Limits

- A crew makes several model calls per task. Set the app's rate limit with that in mind.
- Set `max_completion_tokens` high enough (the example uses 1024) when the model reasons.
