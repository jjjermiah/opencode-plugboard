# Spring AI with plugboard

Spring AI 2.0.1 (`spring-ai-starter-model-openai`, Spring Boot 4.0.8, Java 21) against plugboard's Chat Completions route: a chat, a stream and a tool round trip through a `@Tool` method. The client guide is [docs/clients/spring-ai.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/clients/spring-ai.md).

- `src/main/resources/application.properties`: the three properties plugboard needs, and the runner's quiet-logging settings.
- `src/main/java/example/plugboard/springai/Runner.java`: the harness runner (chat, stream, tool). A scripted run is committed in `runs/scripted/` and CI checks it.
- `pom.xml`, `mvnw`: pinned versions and the Maven wrapper (Maven 3.9.11).

```properties
spring.ai.openai.api-key=<your app key>
spring.ai.openai.base-url=http://127.0.0.1:4010/v1
spring.ai.openai.chat.options.model=fast
```

## Run it

```sh
export JAVA_HOME=<a JDK 21>
bun examples/_harness/run.ts spring-ai --target scripted
```

The harness starts a scripted plugboard, then `run.sh` builds with `./mvnw package` and runs the jar. A cold build downloads about 140 MB and takes under 30 seconds.

## What the scripted run shows

S1 chat, S2 tool round trip and S3 stream pass on `fast`, `anthropic/claude-haiku-4-5` and `openai/gpt-5.6-luna#low` (S3 on `fast`). Spring AI sends `stream_options.include_usage` on a stream, so the usage chunk arrives.

## Gotchas

- **`base-url` must end in `/v1`.** Spring AI 2.0 builds its client on the official OpenAI Java SDK, whose base URL already holds the version. `http://127.0.0.1:4010` gives `404 No route for POST /chat/completions`. A trailing slash is fine. `spring.ai.openai.chat.completions-path` has no effect in 2.0.1, so it cannot repair the short form. Spring AI 1.x was not run here, so a guide written for it may say otherwise.
- Set the model per call with `.options(OpenAiChatOptions.builder().model("anthropic/claude-haiku-4-5"))`, or the property above for a default. Spring AI 2.0 takes the options builder, not the built options.
- Spring AI runs the tool itself, so a program sees only the final answer. The runner records the tool's name and argument from inside the tool method, and cannot check the first turn's finish reason or the call id.
- A model id with `/` or `#` goes in the JSON body, so it needs no escaping.
