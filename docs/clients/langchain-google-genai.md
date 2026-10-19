# LangChain Google GenAI

`ChatGoogleGenerativeAI` from `langchain-google-genai`, on plugboard's [Gemini API](../gemini.md).

## Connect

`base_url` is the plugboard origin; the client adds `/v1beta`:

<<< @/../examples/langchain-google-genai/llm.py#snippet-client

## Chat

<<< @/../examples/langchain-google-genai/chat.py#snippet

## Tool calls

<<< @/../examples/langchain-google-genai/tools.py#snippet-tool

<<< @/../examples/langchain-google-genai/tools.py#snippet-round-trip

LangChain makes up the tool call id; Gemini sends none.

## Streaming

<<< @/../examples/langchain-google-genai/stream.py#snippet

## Images

<<< @/../examples/langchain-google-genai/image.py#snippet

## Structured output

<<< @/../examples/langchain-google-genai/structured.py#snippet

## Model names

A `#` in a model name must be sent as `%23`; a `/` goes as it is. See [Gemini model names](../gemini.md#model-names).

## Limits

- Errors raise `ChatGoogleGenerativeAIError`, with Google's error body in the message.
- The JavaScript package `@langchain/google-genai` cannot cancel a stream cleanly: an abort reports `Error reading from the stream`, raised by the `@google/generative-ai` SDK it uses. To cancel a stream from JavaScript, use [`@google/genai`](google-genai-js.md).
