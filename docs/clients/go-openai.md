# Go (go-openai)

Verified: run, 2026-10-13. `examples/go-openai` (go-openai v1.43.0, Go 1.27.2) ran twice against plugboard with model `fast`: a text call, a stream and one tool round trip all passed. The config was checked against the go-openai README (`DefaultConfig`, `BaseURL`), <https://github.com/sashabaranov/go-openai>. Not in `docs/compatibility.md` yet: there is no scripted test for it.

go-openai is the community Go client for the OpenAI API. It is not an official OpenAI library. It covers Chat Completions, the Responses API, streaming and tool calls.

## Plugboard config

```go
cfg := openai.DefaultConfig(os.Getenv("PLUGBOARD_KEY"))
cfg.BaseURL = "http://127.0.0.1:4010/v1"
client := openai.NewClientWithConfig(cfg)
```

- `BaseURL` replaces the default `https://api.openai.com/v1` whole, so include `/v1`.
- The key is a plugboard app key, not an OpenAI key.
- `fast` is an alias from the plugboard `aliases` option. Use it as the `Model` string; go-openai accepts any model id as a string.

A copyable program is in [examples/go-openai/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/go-openai).

## What the example does

`main.go` makes three calls against `POST /v1/chat/completions`:

1. A text reply.
2. A streamed reply through `CreateChatCompletionStream`, read until `io.EOF`.
3. One tool round trip: the model asks for `get_weather`, the program returns a result as a `tool` message, and the model answers.

Run it:

```sh
cd examples/go-openai
PLUGBOARD_KEY=<app key> go run .
```

## Features exercised

- Chat Completions with `Messages`, `Tools` and `MaxCompletionTokens`.
- Streaming with `Stream: true`.
- Function tools with a JSON Schema `Parameters` value.

Not exercised: the Responses API (`CreateResponse`, which go-openai also has) and structured output (`ChatCompletionResponseFormatJSONSchema`).

## Quirks

- The example sets `MaxCompletionTokens: 1024`, so a model that spends tokens on reasoning (such as `fast`, which points at a reasoning model) still has room to answer. go-openai rejects the deprecated `MaxTokens` field client-side only for real OpenAI reasoning model ids (`o1`, `o3`, `o4`, `gpt-5` and later), never for an alias like `fast`, and plugboard accepts either field.
- `NewClientWithConfig` takes the whole config. Changing `BaseURL` after `NewClient` is not possible; build the config first.
- The README's quick start uses the Responses API. Plugboard serves `/v1/responses` too ([Responses API](../responses.md)), but this page uses Chat Completions because that is the path the example checks.
