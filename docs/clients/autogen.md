# AutoGen / AG2

The classic `autogen` package (`ConversableAgent`, `LLMConfig`). The redesigned `ag2` 1.x API has no `ConversableAgent`; this page doesn't apply to it.

## Connect

`BASE` is `http://127.0.0.1:4010/v1` and `KEY` is your plugboard key.

<<< @/../examples/autogen/chat.py#snippet

<<< @/../examples/autogen/chat.py#snippet-chat

Pass the endpoint in the entry dict; keyword arguments to `LLMConfig` don't set it. `llm_config(stream=True)` streams.

A tool round trip is two agents: the assistant registers the function for the model, the user agent executes it.

<<< @/../examples/autogen/chat.py#snippet-tools

The script with a text reply, a stream and this tool chat is in [examples/autogen/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/autogen):

```sh
cd examples/autogen
PLUGBOARD_KEY=<app key> uv run chat.py
```

## What works

Chat Completions with streaming, and function tools with `register_for_llm` and `register_for_execution`. `api_type: "anthropic"` with `base_url` set to the plugboard origin uses the [Messages API](../messages.md).

## Limits

- autogen logs `Model fast is not found. The cost will be 0.` for an alias. Add a `price` field to the entry to silence it.
- A tool round takes four turns (prompt, call, result, answer). Set `max_turns` to at least 4 and don't terminate on the first message.
