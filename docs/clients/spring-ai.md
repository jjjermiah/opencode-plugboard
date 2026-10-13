# Spring AI

Status: docs-verified, not run. No example. Spring AI's OpenAI module was not built or run against plugboard in this change: no Maven on the machine, and the lane had no Java build. The property names are checked against the Spring AI reference, <https://docs.spring.io/spring-ai/reference/api/chat/openai-chat.html> (Connection Properties, Configuration Properties and Runtime Options), read 2026-10-13. The page does not print a version number; the review of this PR identifies it as Spring AI 2.0.1, and the properties above were checked against that reference. Not in `docs/compatibility.md`.

Spring AI is the Spring project's AI framework. Its OpenAI module talks Chat Completions to any OpenAI-compatible base URL. It is not an official OpenAI library.

## Plugboard config

`application.yml`:

```yaml
spring:
  ai:
    openai:
      base-url: http://127.0.0.1:4010/v1
      api-key: <app key>
```

- `spring.ai.openai.base-url` is "the URL to connect to" in the reference table. Include `/v1` as the issue states, and check the path on your Spring AI version (see Quirks).
- `api-key` is a plugboard app key, not an OpenAI key.
- Pick a model with `spring.ai.openai.chat.model: fast` or `OpenAiChatOptions.builder().model("fast")`. `fast` is the plugboard alias.
- Set a token limit high enough for a reasoning model behind `fast`. The reference's Token Limit Parameters section covers which parameter to use for which model.

Manual configuration, per the reference:

```java
var chatModel = OpenAiChatModel.builder()
    .options(OpenAiChatOptions.builder()
        .apiKey("<app key>")
        .model("fast")
        .build())
    .build();
```

The manual snippet sets no base URL, so set it through the properties above. A programmatic base-URL setter was not checked.

## Quirks (from the issue, not run here)

- Older Spring AI releases append `/v1/chat/completions` to `base-url`. The issue says Spring AI 2.0.0-M6 and later take `OPENAI_BASE_URL` with `/v1` included. Check which form your version expects; if the path doubles, the issue names `spring.ai.openai.chat.completions-path` as the override.
- `spring.ai.openai.chat.base-url` overrides the shared `base-url` for chat only.

## Unverified

- The `completions-path` property: it is named in #232 and is not in the Connection Properties table in the reference. Verify it in the version you run.
- Streaming, tool calls and structured output (`response-format.type=JSON_SCHEMA`): #232 lists them. None was run here.
- The `OPENAI_BASE_URL` fallback in Spring AI 2.0.0-M6: from #232, not checked.

To close the gap, run a Spring Boot chat controller with the property block above against the dev server and record the result here.
