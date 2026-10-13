# LangChain4j

Status: docs-verified, not run. No example. LangChain4j's OpenAI module was not built or run against plugboard in this change: no Maven on the machine, and the lane had no Java build. The builder and dependency are checked against the LangChain4j OpenAI-compatible page, <https://docs.langchain4j.dev/integrations/language-models/openai-compatible/> (Plain Java, Ollama, and the `accumulateToolCallId` section). Not in `docs/compatibility.md`.

LangChain4j is a Java library for LLM apps. It is not an official OpenAI library. Its OpenAI module works with any OpenAI-compatible base URL.

## Plugboard config

Dependency (Plain Java, per the page):

```xml
<dependency>
    <groupId>dev.langchain4j</groupId>
    <artifactId>langchain4j-open-ai</artifactId>
    <version>1.22.0</version>
</dependency>
```

Chat model:

```java
ChatModel model = OpenAiChatModel.builder()
    .baseUrl("http://127.0.0.1:4010/v1")
    .apiKey("<app key>")
    .modelName("fast")
    .build();
```

- `baseUrl` replaces the default `https://api.openai.com/v1`. The Ollama example on the page uses a trailing slash (`http://localhost:11434/v1/`); the issue uses none. Both are shown on the page, so either is expected to work, but the issue's form was not run.
- `apiKey` is a plugboard app key, not an OpenAI key.
- `modelName("fast")` is the plugboard alias.
- Streaming uses `OpenAiStreamingChatModel` with the same builder pattern (the page names this class for streaming).

## Quirks (from the page and #233, not run here)

- The page lists `accumulateToolCallId` for `OpenAiStreamingChatModel`. #233 says to set `accumulateToolCallId(false)` for providers that repeat the tool-call id in every chunk. Plugboard's behaviour here was not checked.
- The pinned version is 1.22.0. A note cited by the review of this PR says LangChain4j versions before 1.23.0 need HTTP/1.1 configured explicitly. The OpenAI-compatible page's sections I could read (Prerequisites, Plain Java, Spring Boot and the provider sections) do not show that note, so it could not be confirmed on the page. If it applies, configure HTTP/1.1 on the client, or pin 1.23.0 or later. Not run against plugboard, so the effect on plugboard is unverified.
- #233 says the custom Java REST client appends `chat/completions` to `baseUrl`, and the official-SDK integration (`langchain4j-open-ai-official`) reads `OPENAI_BASE_URL`. Neither was checked; the page does not pin which one the `langchain4j-open-ai` artifact uses.

## Unverified

- The chat and tool-call round trip, streaming and structured output: #233 lists them. None was run here.
- The `OPENAI_BASE_URL` path for `langchain4j-open-ai-official`.

To close the gap, add a `main` with one tool, run it against the dev server, and record the result here.
