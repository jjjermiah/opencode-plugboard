# LangChain Python

`ChatOpenAI` from `langchain-openai`. For Claude through the Messages API use [LangChain Python (ChatAnthropic)](langchain-anthropic-python.md); for Gemini, [LangChain Google GenAI](langchain-google-genai.md).

## Connect

<<< @/../examples/langchain-python/llm.py#snippet

Set `use_responses_api=False` to stay on Chat Completions: otherwise some model ids (`gpt-5.6...`) switch the client to the Responses API.

## Chat

<<< @/../examples/langchain-python/chat.py#snippet

## Tool calls

<<< @/../examples/langchain-python/tools.py#snippet-tool

<<< @/../examples/langchain-python/tools.py#snippet-round-trip

## Structured output

`llm.with_structured_output(Meal, method="json_schema")` and `method="function_calling"` both work. Avoid `method="json_mode"`: it sends no schema, so the model guesses the keys.

## Responses API

`ChatOpenAI(use_responses_api=True, ...)` sends the same calls to `/v1/responses`:

<<< @/../examples/langchain-python/llm.py#snippet-responses

On that route LangChain exposes no `finish_reason`; read `response_metadata["status"]` instead.

## Limits

- LangChain has no model-list call. Use the wrapped client: `llm.root_client.models.list()`.
- Errors are the `openai` package's: `AuthenticationError` (401), `NotFoundError` (404).
