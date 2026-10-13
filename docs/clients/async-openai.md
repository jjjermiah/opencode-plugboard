# Rust (async-openai)

Verified: run, 2026-10-13. `examples/async-openai` (async-openai 0.42.2, the `chat-completion` feature, Rust 1.98.1) ran against plugboard with model `fast`: a text call, a stream and one tool round trip all passed. The config was checked against the docs.rs page for `OpenAIConfig` (<https://docs.rs/async-openai/latest/async_openai/config/struct.OpenAIConfig.html>) and against the crate source (`src/config.rs`). Not in `docs/compatibility.md` yet: there is no scripted test for it.

async-openai is the community Rust client for the OpenAI API. It is not an official OpenAI library. It covers Chat Completions, the Responses API, streaming and tool calls.

## Plugboard config

```rust
use async_openai::{Client, config::OpenAIConfig};

let config = OpenAIConfig::new()
    .with_api_key(std::env::var("PLUGBOARD_KEY")?)
    .with_api_base("http://127.0.0.1:4010/v1");
let client = Client::with_config(config);
```

- `with_api_base` replaces the default `https://api.openai.com/v1` whole, so include `/v1`.
- The key is a plugboard app key, not an OpenAI key. `with_api_key` replaces the `OPENAI_API_KEY` default.
- `fast` is an alias from the plugboard `aliases` option. Pass it as the `model` string.

Set the base in code, as above. Do not rely on an environment variable for it: see Quirks.

A copyable program is in [examples/async-openai/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/async-openai).

## What the example does

`src/main.rs` makes three calls against `POST /v1/chat/completions`:

1. A text reply.
2. A streamed reply through `create_stream`, read with `futures::StreamExt`.
3. One tool round trip: the model calls `get_weather`, the program returns a `tool` message, and the model answers.

Run it:

```sh
cd examples/async-openai
PLUGBOARD_KEY=<app key> cargo run
```

## Features exercised

- Chat Completions with `messages`, `tools` and `max_completion_tokens`.
- Streaming with `stream(true)` and `create_stream`.
- Function tools with a JSON Schema `parameters` value.

Not exercised: the Responses API and structured output. The crate also covers both, and plugboard serves `/v1/responses` ([Responses API](../responses.md)).

## Quirks

- The crate reads `OPENAI_BASE_URL` for its default base (`src/config.rs:60`). `OPENAI_API_BASE` is the name of the constant that holds the default URL, and the doc comment on `new()` names both, so the two are easy to confuse. Issue #235 says `OPENAI_API_BASE` is the env var; it is not. The example sets the base in code with `with_api_base`, so the env var does not matter here.
- The API is behind Cargo features. A project that only needs chat must enable `chat-completion`; without it, `async_openai::config` and the chat types do not compile.
- Chat types live under `async_openai::types::chat`. Some message and tool types are plain structs (build them with a struct literal), and others have `*Args` builders. Check the 0.42 docs when you upgrade.
- The example sets `max_completion_tokens` to 1024, so a reasoning model behind the `fast` alias still has room to answer.
