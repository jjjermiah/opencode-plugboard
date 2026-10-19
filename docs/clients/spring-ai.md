# Spring AI

Spring AI's OpenAI chat module.

## Connect

`application.properties`. `PLUGBOARD_BASE_URL` is `http://127.0.0.1:4010/v1` and `PLUGBOARD_KEY` is your plugboard key:

<<< @/../examples/spring-ai/src/main/resources/application.properties#snippet{properties}

`base-url` must end in `/v1` (Spring AI 2.x uses the official OpenAI Java SDK, which appends `/chat/completions`). Without `/v1` every call is a 404.

## Chat

Set the model per call with `.options(OpenAiChatOptions.builder().model("fast"))`. Model names with `/` or `#` need no escaping.

<<< @/../examples/spring-ai/src/main/java/example/plugboard/springai/Runner.java#snippet

## Tool calls

Spring AI runs the tool and sends the result back before it answers.

<<< @/../examples/spring-ai/src/main/java/example/plugboard/springai/Runner.java#snippet-tool

<<< @/../examples/spring-ai/src/main/java/example/plugboard/springai/Runner.java#snippet-tools

## Streaming

<<< @/../examples/spring-ai/src/main/java/example/plugboard/springai/Runner.java#snippet-stream

The runnable app is in [examples/spring-ai/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/spring-ai).

## What works

Chat, streaming (with usage), and `@Tool` methods, which Spring AI runs itself before it answers.

## Limits

- When the model reasons, set a token limit high enough for it to answer (see Spring AI's Token Limit Parameters for which property applies).
