# Semantic Kernel

Verified: run, 2026-10-13, Python route only. `examples/semantic-kernel/chat.py` (semantic-kernel 1.45.0, Python 3.13, run with `uv run`) ran against plugboard with model `fast`: a text call, a stream and a plugin function call made through automatic function calling all passed. The Python config was checked against the installed package's `OpenAIChatCompletion` and `OpenAIChatPromptExecutionSettings`, and the sources #229 names. The .NET route (`AddOpenAIChatCompletion`) was not run. Not in `docs/compatibility.md` yet: there is no scripted test for it.

Semantic Kernel is Microsoft's SDK for agents and plugins, in .NET, Python and Java. It is not an official OpenAI library. Its OpenAI connector accepts a custom endpoint.

## Plugboard config (Python)

```python
from openai import AsyncOpenAI
from semantic_kernel.connectors.ai.open_ai import OpenAIChatCompletion

client = AsyncOpenAI(base_url="http://127.0.0.1:4010/v1", api_key="<app key>")
service = OpenAIChatCompletion(ai_model_id="fast", async_client=client)
```

- The Python connector takes a custom `AsyncOpenAI` client. `base_url` on that client replaces the default `https://api.openai.com/v1` whole, so include `/v1`.
- `api_key` is a plugboard app key, not an OpenAI key.
- Pass the client, not `api_key` or `base_url`, to `OpenAIChatCompletion`. Passing both conflicts with the client.
- `ai_model_id="fast"` is the plugboard alias. The connector sends it as the model.

## Plugboard config (.NET, not run)

```csharp
builder.Services.AddOpenAIChatCompletion(
    modelId: "fast",
    endpoint: new Uri("http://127.0.0.1:4010/v1"),
    apiKey: "<app key>");
```

The endpoint form is taken from #229. It was not run here.

A copyable script is in [examples/semantic-kernel/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/semantic-kernel).

## What the example does

`chat.py` makes three calls:

1. A text reply through `get_chat_message_content`.
2. A streamed reply through `get_streaming_chat_message_content`, counting non-empty updates.
3. A `WeatherPlugin` function (`get_weather`) exposed through a `Kernel`. `FunctionChoiceBehavior.Auto(auto_invoke=True)` lets the model call it, and the script fails if it was not called.

Run it:

```sh
cd examples/semantic-kernel
PLUGBOARD_KEY=<app key> uv run chat.py
```

## Features exercised

- Chat Completions through `OpenAIChatCompletion` with a custom `AsyncOpenAI` client.
- Streaming through `get_streaming_chat_message_content`.
- A kernel plugin function with `FunctionChoiceBehavior.Auto` and automatic invocation.

Not exercised: structured output, the .NET route, and the Responses API (`OpenAIResponseAgent`, which the issue mentions for .NET).

## Quirks

- The streamed reply gave one non-empty content update through Semantic Kernel, while the server sent several SSE events. The count is what the connector yields, not a server limit; the script does not check it.
- `max_completion_tokens` is set to 1024, so a reasoning model behind the `fast` alias still has room to answer.
