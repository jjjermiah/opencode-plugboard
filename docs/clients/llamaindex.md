# LlamaIndex

LlamaIndex's `OpenAILike` LLM class.

## Connect

```sh
pip install llama-index-llms-openai-like
```

<<< @/../examples/llamaindex/example.py#snippet

Keep `/v1` in `api_base`. Set `context_window`, `is_chat_model` and `is_function_calling_model`: for a custom model id LlamaIndex can't look them up, and without `is_function_calling_model=True` tool calling is off.

## What works

`complete`, `chat`, `stream_complete` and `stream_chat`; tool calling with `chat_with_tools` and `FunctionTool`; agents and query engines built on the LLM.

## Limits

- Use `OpenAILike`, not `OpenAI`. The `OpenAI` class looks the model name up in OpenAI's own table and raises `ValueError: Unknown model 'fast'` for plugboard aliases and `provider/model` ids.
- `stream_chat` requests no usage chunk, so streamed answers carry no token counts.
