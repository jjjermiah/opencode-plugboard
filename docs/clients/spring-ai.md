# Spring AI

Spring AI's OpenAI chat module.

## Connect

`application.yml`:

```yaml
spring:
  ai:
    openai:
      base-url: http://127.0.0.1:4010/v1
      api-key: ${PLUGBOARD_KEY}
      chat:
        options:
          model: fast
```

`base-url` must end in `/v1` (Spring AI 2.x uses the official OpenAI Java SDK, which appends `/chat/completions`). Without `/v1` every call is a 404.

Set the model per call with `.options(OpenAiChatOptions.builder().model("fast"))`. Model names with `/` or `#` need no escaping. A runnable app is in [examples/spring-ai/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/spring-ai).

## What works

Chat, streaming (with usage), and `@Tool` methods, which Spring AI runs itself before it answers.

## Limits

- When the model reasons, set a token limit high enough for it to answer (see Spring AI's Token Limit Parameters for which property applies).
