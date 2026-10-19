# LangChain4j with plugboard

LangChain4j 1.22.0 (`langchain4j-open-ai`, Java 21) against plugboard's Chat Completions route: a chat, a stream, a tool round trip and a streamed tool call. The client guide is [docs/clients/langchain4j.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/clients/langchain4j.md).

- `src/main/java/example/plugboard/langchain4j/Runner.java`: the harness runner. A scripted run is committed in `runs/scripted/` and CI checks it.
- `pom.xml`, `mvnw`: pinned versions and the Maven wrapper (Maven 3.9.11).

```java
var chat = OpenAiChatModel.builder()
    .baseUrl("http://127.0.0.1:4010/v1")
    .apiKey("<your app key>")
    .modelName("fast")
    .build();
```

## Run it

```sh
export JAVA_HOME=<a JDK 21>
bun examples/_harness/run.ts langchain4j --target scripted
```

The harness starts a scripted plugboard, then `run.sh` builds with `./mvnw package`, copies the dependencies and runs the class. A cold build downloads about 45 MB and takes under 20 seconds.

## What the scripted run shows

S1 chat, S2 tool round trip (the program sends the result back as a `ToolExecutionResultMessage`), S3 stream and S4 streamed tool call all pass, on `fast`, `anthropic/claude-haiku-4-5` and `openai/gpt-5.6-luna#low` (S3 and S4 on `fast`).

## Gotchas

- **`baseUrl` ends in `/v1`.** The builder appends `/chat/completions`. A trailing slash was not tried.
- **HTTP version:** 1.22.0's default JDK HTTP client worked against plugboard with no HTTP/1.1 setting, for both the call and the stream. The "before 1.23.0 needs HTTP/1.1" note in the issue did not show up here, but 1.23.0 does not exist yet (the newest release on Maven Central is 1.22.0, 2026-10-08), so that version was not tried.
- **`accumulateToolCallId`:** the default and `false` both pass S4. Plugboard sends a call's id whole in one chunk, so there is nothing to accumulate.
- LangChain4j logs through SLF4J. The example binds `slf4j-nop` so nothing but the runner's lines reaches stdout.
