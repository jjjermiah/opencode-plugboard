# Rust (async-openai)

The community `async-openai` crate.

## Connect

<<< @/../examples/async-openai/src/main.rs#snippet

`with_api_base` replaces the default whole, so include `/v1`. Set the base in code: the crate's environment variable for it is `OPENAI_BASE_URL`, not `OPENAI_API_BASE`. `model` is an alias such as `"fast"` or any allowed `provider/model[#variant]`.

The full program, with a text reply, a stream and a tool round trip, is in [examples/async-openai/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/async-openai):

```sh
cd examples/async-openai
PLUGBOARD_KEY=<app key> cargo run
```

## What works

Chat Completions with streaming (`create_stream`, with `include_usage`) and tool calls; the Responses API and structured output through the crate's own types.

## Limits

- Enable the Cargo feature for the API you use (`chat-completion` for chat); without it the config and chat types don't compile.
- Set `max_completion_tokens` high enough (the example uses 1024) when the model reasons.
