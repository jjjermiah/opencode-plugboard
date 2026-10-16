# LangChain Google GenAI

<ExampleResult example="langchain-google-genai" />

Tested: `langchain-google-genai` 4.4.2, live run [`2026-10-16-987338b`](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/langchain-google-genai/runs/live/2026-10-16-987338b) at plugboard 0.37.0 (`987338b`): partial. S5, the image, hits [#401](https://github.com/jjjermiah/opencode-plugboard/issues/401): LangChain sends `inlineData` as `mime_type`, which plugboard rejects. The code below is the example's snippets.

## Setup

`ChatGoogleGenerativeAI` adds `/v1beta` itself. Its `base_url` is the plugboard origin:

<<< @/../examples/langchain-google-genai/llm.py#snippet-client

The snippets use `client(model)`, which returns that model; `"fast"` is an alias from the plugboard `aliases` option.

## Chat

<<< @/../examples/langchain-google-genai/chat.py#snippet

## Tool call

The tool is a `@tool`, and the round trip sends the `ToolMessage` back with the call's id:

<<< @/../examples/langchain-google-genai/tools.py#snippet-tool

<<< @/../examples/langchain-google-genai/tools.py#snippet-round-trip

## Streaming

<<< @/../examples/langchain-google-genai/stream.py#snippet

<<< @/../examples/langchain-google-genai/stream_tools.py#snippet

## Image

<<< @/../examples/langchain-google-genai/image.py#snippet

## Structured output

`with_structured_output` takes a pydantic model:

<<< @/../examples/langchain-google-genai/structured.py#snippet

## Model ids

A bare `#` starts a URL fragment, so `llm.py` sends the variant as `%23`. A `/` goes as it is. See [Gemini API](../gemini.md#model-names).

## Errors

LangChain raises `ChatGoogleGenerativeAIError` with Google's error body in the message. The example reads the HTTP code and the status from it.

<<< @/../examples/langchain-google-genai/errors.py#snippet-wrong-key

<<< @/../examples/langchain-google-genai/errors.py#snippet-unknown-model

## Gotchas

- The model list is not part of `ChatGoogleGenerativeAI`, so S7 does not apply.
- LangChain generates the tool call's id locally. Gemini does not send one.
