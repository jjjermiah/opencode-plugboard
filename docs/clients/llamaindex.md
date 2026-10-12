# LlamaIndex

Run 2026-10-12 against the scripted fake plugboard, not the live dev server (nothing listened on `127.0.0.1:4010`): `llama-index-llms-openai` 0.8.2 with `llama-index-core` 0.14.25, Python 3.12. `text: pass`, `stream: pass`, `tool call: pass`, `tool round trip: pass`, via [examples/llamaindex/example.py](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/llamaindex). The `OpenAI` and `OpenAILike` signatures (`api_base`, `api_key`, `context_window`, `is_chat_model`, `is_function_calling_model`) were checked against LlamaIndex's API reference. The issue's first snippet, `OpenAI(model="fast", ...)`, fails on plugboard ids; see Quirks.

LlamaIndex is a framework for RAG and agents. Its LLM classes call a base URL, so plugboard's `POST /v1/chat/completions` gets the requests.

## Plugboard options

```jsonc
"options": {
  "keys": { "llamaindex": "{env:PLUGBOARD_KEY_LLAMAINDEX}" },
  "models": ["anthropic/claude-haiku-4-5"],
  "aliases": { "fast": "anthropic/claude-haiku-4-5" }
}
```

Every alias target must also be in `models`.

## LlamaIndex config

```sh
pip install llama-index-llms-openai llama-index-llms-openai-like
```

```python
from llama_index.llms.openai_like import OpenAILike

llm = OpenAILike(
    model="fast",
    api_base="http://127.0.0.1:4010/v1",
    api_key="<your plugboard app key>",
    context_window=200000,
    is_chat_model=True,
    is_function_calling_model=True,
)
print(llm.complete("Reply with exactly: pong").text)
```

Keep `/v1` in `api_base`. The OpenAI client appends `/chat/completions`.

## Features exercised

- Text completion, streamed (`stream_complete`).
- Tool calling: `chat_with_tools` sends a `FunctionTool`, `get_tool_calls_from_response` reads the call, and a `tool` message carries the result back for the follow-up turn.
- Not run: structured output (`structured_predict`), and query engines over an index.

## Quirks

- **The `OpenAI` class does not work with plugboard ids.** Its `metadata` property looks the model name up in OpenAI's own table, and `fast` is not there, so `complete` raises `ValueError: Unknown model 'fast'`. Use `OpenAILike` for any id that is not an OpenAI model name. The issue's first snippet is wrong for plugboard.
- `OpenAILike` needs `context_window`, `is_chat_model` and `is_function_calling_model` for a custom id. Without them, tool calling is off and the context size is unknown.
- `api_key` must be non-empty. A plugboard app key is the right value; a placeholder gets 401.

## Verified

Run against the fake, as above. The live dev server was not up, so a live run is still open.
