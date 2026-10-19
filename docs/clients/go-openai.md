# Go (go-openai)

`github.com/sashabaranov/go-openai`, the community Go client for the OpenAI API.

## Connect

```go
cfg := openai.DefaultConfig(os.Getenv("PLUGBOARD_KEY"))
cfg.BaseURL = "http://127.0.0.1:4010/v1"
client := openai.NewClientWithConfig(cfg)
```

`BaseURL` replaces the default whole, so include `/v1`. Use an alias such as `"fast"`, or any allowed `provider/model[#variant]`, as the `Model` string.

A complete program with a text reply, a stream and a tool round trip is in [examples/go-openai/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/go-openai):

```sh
cd examples/go-openai
PLUGBOARD_KEY=<app key> go run .
```

## What works

Chat Completions with streaming, tool calls and `ResponseFormat` JSON schema; the Responses API through `CreateResponse`.

## Limits

- Set `MaxCompletionTokens` rather than `MaxTokens` when the model reasons, so it has room to answer. go-openai rejects `MaxTokens` itself only for OpenAI reasoning model ids; plugboard accepts either.
- Build the config before `NewClientWithConfig`; the base URL can't be changed afterwards.
