# AutoGen / AG2

The classic `autogen` package (`ConversableAgent`, `LLMConfig`). The redesigned `ag2` 1.x API has no `ConversableAgent`; this page doesn't apply to it.

## Connect

```python
from autogen import ConversableAgent, LLMConfig

llm = LLMConfig({
    "api_type": "openai",
    "model": "fast",
    "base_url": "http://127.0.0.1:4010/v1",
    "api_key": os.environ["PLUGBOARD_KEY"],
    "max_tokens": 1024,
})
bot = ConversableAgent("bot", llm_config=llm, human_input_mode="NEVER")
```

Pass the endpoint in the entry dict; keyword arguments to `LLMConfig` don't set it. Add `"stream": True` to stream.

A script with a text reply, a stream and a two-agent tool chat is in [examples/autogen/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/autogen):

```sh
cd examples/autogen
PLUGBOARD_KEY=<app key> uv run chat.py
```

## What works

Chat Completions with streaming, and function tools with `register_for_llm` and `register_for_execution`. `api_type: "anthropic"` with `base_url` set to the plugboard origin uses the [Messages API](../messages.md).

## Limits

- autogen logs `Model fast is not found. The cost will be 0.` for an alias. Add a `price` field to the entry to silence it.
- A tool round takes four turns (prompt, call, result, answer). Set `max_turns` to at least 4 and don't terminate on the first message.
