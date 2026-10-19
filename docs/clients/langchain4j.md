# LangChain4j

LangChain4j's `langchain4j-open-ai` module.

## Connect

```xml
<dependency>
    <groupId>dev.langchain4j</groupId>
    <artifactId>langchain4j-open-ai</artifactId>
    <version>1.22.0</version>
</dependency>
```

```java
ChatModel model = OpenAiChatModel.builder()
    .baseUrl("http://127.0.0.1:4010/v1")
    .apiKey(System.getenv("PLUGBOARD_KEY"))
    .modelName("fast")
    .build();
```

`baseUrl` ends in `/v1`. For streaming use `OpenAiStreamingChatModel` with the same builder. A runnable example is in [examples/langchain4j/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/langchain4j).

## What works

Chat, streaming, tool calls (`@Tool` with AI Services, or `ToolExecutionResultMessage` by hand), streamed tool calls and structured output.
