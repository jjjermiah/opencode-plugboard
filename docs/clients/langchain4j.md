# LangChain4j

LangChain4j's `langchain4j-open-ai` module.

## Connect

Add `dev.langchain4j:langchain4j-open-ai` to your build (the version is in the example's [`pom.xml`](https://github.com/jjjermiah/opencode-plugboard/blob/main/examples/langchain4j/pom.xml)). `BASE_URL` is `http://127.0.0.1:4010/v1` and `KEY` is your plugboard key.

<<< @/../examples/langchain4j/src/main/java/example/plugboard/langchain4j/Runner.java#snippet-model

`baseUrl` ends in `/v1`; `modelName` is an alias such as `fast`.

## Chat

<<< @/../examples/langchain4j/src/main/java/example/plugboard/langchain4j/Runner.java#snippet

## Tool calls

Plugboard returns the call. Your code runs the tool and sends the result back.

<<< @/../examples/langchain4j/src/main/java/example/plugboard/langchain4j/Runner.java#snippet-tool

<<< @/../examples/langchain4j/src/main/java/example/plugboard/langchain4j/Runner.java#snippet-tools

## Streaming

<<< @/../examples/langchain4j/src/main/java/example/plugboard/langchain4j/Runner.java#snippet-stream

The runnable project is in [examples/langchain4j/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/langchain4j).

## What works

Chat, streaming, tool calls (`@Tool` with AI Services, or `ToolExecutionResultMessage` by hand), streamed tool calls and structured output.
