# .NET (openai-dotnet)

The official OpenAI .NET library, NuGet package `OpenAI`.

## Connect

```csharp
var options = new OpenAIClientOptions { Endpoint = new Uri("http://127.0.0.1:4010/v1") };
ChatClient client = new(
    model: "fast",
    credential: new ApiKeyCredential(Environment.GetEnvironmentVariable("PLUGBOARD_KEY")!),
    options: options);
```

`Endpoint` replaces the base URL whole, so include `/v1`. Pass the credential explicitly; otherwise the library reads `OPENAI_API_KEY`. `model` is an alias such as `"fast"` or any allowed `provider/model[#variant]`.

A complete console app with a text reply, a stream and a tool round trip is in [examples/openai-dotnet/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/openai-dotnet):

```sh
cd examples/openai-dotnet
PLUGBOARD_KEY=<app key> dotnet run
```

## What works

Chat Completions (`ChatClient`) with streaming, tools and `ChatResponseFormat.CreateJsonSchemaFormat`; the Responses API (`ResponsesClient`). One `OpenAIClientOptions` can be shared across clients.

## Limits

- Set `MaxOutputTokenCount` high enough (the example uses 1024) when the model reasons, so it has room to answer.
