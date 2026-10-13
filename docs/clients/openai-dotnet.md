# .NET (openai-dotnet)

Verified: build only. `examples/openai-dotnet` builds with `dotnet build` (0 warnings, 0 errors) against the `OpenAI` NuGet package 2.14.0, on .NET SDK 8.0.423, 2026-10-12. Not run: the dev server at `127.0.0.1:4010` refused connections that day, so the text, stream and tool calls have not been driven against plugboard. The client construction was checked against the official README, "Using a custom base URL and API key" (<https://github.com/openai/openai-dotnet>).

openai-dotnet is the official OpenAI .NET library, generated from the OpenAI OpenAPI spec. It covers Chat Completions, the Responses API, streaming and tool calls.

## Plugboard config

```csharp
var options = new OpenAIClientOptions { Endpoint = new Uri("http://127.0.0.1:4010/v1") };
ChatClient client = new(
    model: "fast",
    credential: new ApiKeyCredential(Environment.GetEnvironmentVariable("PLUGBOARD_KEY")!),
    options: options);
```

- `Endpoint` replaces the base URL whole, so include `/v1`.
- The key is a plugboard app key, not an OpenAI key. The library reads `OPENAI_API_KEY` only if you pass nothing, so pass the credential explicitly.
- `fast` is an alias from the plugboard `aliases` option. It is the `model` string.

A copyable console app is in [examples/openai-dotnet/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/openai-dotnet).

## What the example does

`Program.cs` makes three calls against `POST /v1/chat/completions`:

1. A text reply with `CompleteChat`.
2. A streamed reply with `CompleteChatStreaming`, enumerated as it arrives.
3. One tool round trip: `ChatTool.CreateFunctionTool` describes `get_weather`, the program returns a `ToolChatMessage` with the result, and the model answers.

Run it:

```sh
cd examples/openai-dotnet
PLUGBOARD_KEY=<app key> dotnet run
```

## Features exercised

- Chat Completions (`ChatClient`) with `MaxOutputTokenCount`, tools and streaming.

Not exercised: the Responses API (`ResponsesClient`) and structured output (`ChatResponseFormat.CreateJsonSchemaFormat`). The library also covers both, and plugboard serves `/v1/responses` ([Responses API](../responses.md)).

## Quirks

- The reasoning-model output cap is `MaxOutputTokenCount` in this library version. The example sets 1024.
- The library is organized by namespace (`OpenAI.Chat`, `OpenAI.Responses`, and so on). `OpenAIClientOptions` is one object that can be reused across clients.
- The NuGet package is `OpenAI`, not `openai-dotnet`.
