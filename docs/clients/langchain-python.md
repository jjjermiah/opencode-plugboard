# LangChain Python

<ExampleResult example="langchain-python" />

Tested: `langchain-openai` 1.7.0, `langchain-core` 1.6.9, live run [`2026-10-13-c97ac66`](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/langchain-python/runs/live/2026-10-13-c97ac66) at plugboard 0.26.0 (`c97ac66`): pass. Every scenario passed on `fast`, `anthropic/claude-haiku-4-5` and `openai/gpt-5.6-luna#low`. `json_mode` on `fast` returned valid JSON on that run (one sample; see Structured output). The code below is the example's snippet, and the run's report and transcripts are in the example directory.

The client is built once, in [`llm.py`](https://github.com/jjjermiah/opencode-plugboard/blob/main/examples/langchain-python/llm.py). The function needs `import os` and the module constant `NO_RETRIES = {"max_retries": 0}`:

<<< @/../examples/langchain-python/llm.py#snippet

`fast` is an alias from the plugboard `aliases` option. Use any allowed `provider/model[#variant]` instead.

## Chat

The snippet uses `client` (the `chat_model` function above) and `model` (`"fast"`).

<<< @/../examples/langchain-python/chat.py#snippet

## Tool call

The tool's result is read from `examples/_shared/get_weather.result.json`. The round trip uses `client`, `model`, `messages` (the user prompt as a `HumanMessage`).

<<< @/../examples/langchain-python/tools.py#snippet-tool

<<< @/../examples/langchain-python/tools.py#snippet-round-trip

## Structured output

`llm.with_structured_output(Meal, method="json_schema")` and `method="function_calling"` both work. `method="json_mode"` sends `json_object` with no schema, and a weak model can return `{}` or numbers as strings. The example is [`structured.py`](https://github.com/jjjermiah/opencode-plugboard/blob/main/examples/langchain-python/structured.py).

## Gotchas

- Set `use_responses_api=False`. Left unset, an id that starts with `gpt-5.6` can switch the client to the Responses API. Plugboard serves that API (see [Responses API](../responses.md)), but this page's runs used Chat Completions. A `provider/` prefix avoids it, but set the flag anyway.
- LangChain has no list-models call. Use the wrapped OpenAI client (`llm.root_client.models.list()`).
- A wrong key raises `openai.AuthenticationError` (401, `invalid_api_key`). An unknown model raises `openai.NotFoundError` (404, `model_not_found`).

## Responses API

`ChatOpenAI` with `use_responses_api=True` sends the same calls to `/v1/responses`. The example's `responses` variant runs chat, tools, streaming, images and structured output on it. LangChain exposes no `finish_reason` on that route, though plugboard returns status `completed`, so those checks are left out of the example's rows (`unobserved`, issue 104).

The snippet builds the client; `chat_model` is the Chat Completions one (above).

<<< @/../examples/langchain-python/llm.py#snippet-responses
