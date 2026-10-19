# Semantic Kernel

Microsoft's Semantic Kernel, through its OpenAI connector.

## Connect (Python)

Give the connector your own `AsyncOpenAI` client pointed at plugboard, and don't also pass `api_key` or `base_url`:

<<< @/../examples/semantic-kernel/chat.py#snippet

A script with a text reply, a stream and a plugin function call is in [examples/semantic-kernel/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/semantic-kernel):

```sh
cd examples/semantic-kernel
PLUGBOARD_KEY=<app key> uv run chat.py
```

## Connect (.NET)

```csharp
builder.Services.AddOpenAIChatCompletion(
    modelId: "fast",
    endpoint: new Uri("http://127.0.0.1:4010/v1"),
    apiKey: Environment.GetEnvironmentVariable("PLUGBOARD_KEY")!);
```

## What works

Chat Completions with streaming, and kernel plugin functions with `FunctionChoiceBehavior.Auto` (automatic or manual invocation).

## Limits

- Semantic Kernel sends tool names prefixed with the plugin name (`weather-get_weather`); expect that name in tool calls.
- Set `max_completion_tokens` high enough (the example uses 1024) when the model reasons.
