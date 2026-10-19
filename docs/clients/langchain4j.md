# LangChain4j

LangChain4j's `langchain4j-open-ai` module.

## Connect

```xml
<dependency>
    <groupId>dev.langchain4j</groupId>
    <artifactId>langchain4j-open-ai</artifactId>
    <version>1.23.0</version>
</dependency>
```

```java
ChatModel model = OpenAiChatModel.builder()
    .baseUrl("http://127.0.0.1:4010/v1")
    .apiKey(System.getenv("PLUGBOARD_KEY"))
    .modelName("fast")
    .build();
```

For streaming use `OpenAiStreamingChatModel` with the same builder.

## What works

Chat, streaming, tool calls (`@Tool` with AI Services) and structured output.

## Limits

- Use 1.23.0 or later; earlier versions need HTTP/1.1 set explicitly on the client.
