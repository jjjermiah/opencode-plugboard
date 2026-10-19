# AutoGen / AG2

The classic `autogen` package (`ConversableAgent`, `LLMConfig`). The redesigned `ag2` 1.x API has no `ConversableAgent`; this page doesn't apply to it.

## Connect

`BASE` is `http://127.0.0.1:4010/v1` and `KEY` is your plugboard key. Install `autogen[openai,anthropic]`.

<<< @/../examples/autogen/llm.py#snippet

<<< @/../examples/autogen/chat.py#snippet

Pass the endpoint in the entry dict; keyword arguments to `LLMConfig` don't set it. `llm_config(stream=True)` streams. Here `cfg` is `llm_config()`.

A tool round trip is two agents: the assistant registers the function for the model, the user agent executes it.

<<< @/../examples/autogen/tools.py#snippet

### Anthropic route

With `api_type: "anthropic"` AutoGen calls the [Messages API](../messages.md). Its Anthropic client adds `/v1/messages` itself, so `base_url` is the plugboard address without `/v1`. Chat and the tool round trip above run unchanged with `cfg = anthropic_config()`.

<<< @/../examples/autogen/llm.py#snippet-anthropic

The code is in [examples/autogen/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/autogen):

```sh
cd examples/autogen
PLUGBOARD_KEY=<app key> uv run chat.py
```

## What works

Chat Completions and Messages, each with chat and function tools (`register_for_llm` and `register_for_execution`). Chat Completions also streams.

## Limits

- autogen logs `Model fast is not found. The cost will be 0.` for an alias. Add a `price` field to the entry to silence it.
- A tool round takes four turns (prompt, call, result, answer). Set `max_turns` to at least 4 and don't terminate on the first message.
- The Anthropic client of AutoGen doesn't stream.
