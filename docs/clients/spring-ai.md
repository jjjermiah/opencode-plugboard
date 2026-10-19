# Spring AI

Spring AI's OpenAI chat module.

## Connect

`application.yml`:

```yaml
spring:
  ai:
    openai:
      base-url: http://127.0.0.1:4010
      api-key: ${PLUGBOARD_KEY}
      chat:
        options:
          model: fast
```

Spring AI appends `/v1/chat/completions` to `base-url`, so leave `/v1` off. If your version doubles the path, set `spring.ai.openai.chat.completions-path`. `spring.ai.openai.chat.base-url` overrides the base for chat only.

In code, set the model per call with `OpenAiChatOptions.builder().model("fast")`.

## What works

Chat Completions with streaming, tool calling and `response-format` JSON schema.

## Limits

- When the model reasons, set a token limit high enough for it to answer (see Spring AI's Token Limit Parameters for which property applies).
