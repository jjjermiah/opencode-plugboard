# AutoGen / AG2 (autogen)

Verified: run, 2026-10-13, OpenAI route only. `examples/autogen/chat.py` (autogen 0.14.1, Python 3.13, run with `uv run`) ran against plugboard with model `fast`: a text call, a stream and a two-agent chat in which the assistant called one tool and answered from its result all passed. The config was checked against the installed package's `LLMConfig` and `ConversableAgent` signatures. Not in `docs/compatibility.md` yet: there is no scripted test for it. The Anthropic route (`api_type: anthropic`) was not run.

AutoGen is a multi-agent framework. The original project is Microsoft's. The name "AG2" also refers to the community fork, which has since moved to a new API. This page covers the classic `config_list` API that issue #230 describes, as shipped in the `autogen` package on PyPI.

## Which package

- Install `autogen==0.14.1` from PyPI. It has the classic `ConversableAgent` and `LLMConfig`, and imports as `autogen`.
- `ag2` 1.x (PyPI, module `ag2`) is a redesigned API with `Agent`, `tool` and `MemoryStream`. It has no `ConversableAgent`, so the config below does not apply to it.

## Plugboard config

```python
from autogen import ConversableAgent, LLMConfig

llm = LLMConfig({
    "api_type": "openai",
    "model": "fast",
    "base_url": "http://127.0.0.1:4010/v1",
    "api_key": "<app key>",
    "max_tokens": 1024,
})
bot = ConversableAgent("bot", llm_config=llm, human_input_mode="NEVER")
```

- `LLMConfig` takes one or more entry dicts. Keyword arguments do not set the endpoint.
- `base_url` replaces the default `https://api.openai.com/v1` whole, so include `/v1`.
- `api_key` is a plugboard app key, not an OpenAI key.
- `"stream": True` in the entry turns on streaming.

A copyable script is in [examples/autogen/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/autogen).

## What the example does

`chat.py` makes three calls:

1. A text reply from one `ConversableAgent`.
2. A streamed reply from an agent whose entry sets `stream: True`.
3. A two-agent chat. The assistant registers `get_weather` for the LLM, the user agent registers it for execution, and the chat runs for four turns. The assistant's last message uses the tool result.

Run it:

```sh
cd examples/autogen
PLUGBOARD_KEY=<app key> uv run chat.py
```

## Features exercised

- The OpenAI Chat Completions route (`api_type: openai`) with `base_url`.
- Streaming with `stream: True`.
- Function tools with `register_for_llm` and `register_for_execution`, in a two-agent chat.

Not exercised: the Anthropic Messages route (`api_type: anthropic`), which #230 also asks for, and any multi-agent loop longer than one tool round.

## Quirks

- autogen has no price for the model name `fast`, so it logs `Model fast is not found. The cost will be 0.` This is a log line only, and it is about autogen's price table, not plugboard. Add a `price` field to the entry to silence it.
- The user agent must not terminate on the first message. `is_termination_msg=lambda m: True` ends the chat before the tool runs, so the example uses `False` and bounds the run with `max_turns`.
- A tool round needs four turns: user message, assistant tool call, user tool result, assistant answer. With fewer turns the chat stops on `Maximum turns` before the final answer.
- `LLMConfig` is not a context manager in 0.14.1. Pass the config object to `llm_config=` directly.
