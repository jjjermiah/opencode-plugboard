# Haystack

deepset's Haystack, through `OpenAIChatGenerator`.

## Connect

```sh
pip install haystack-ai
```

<<< @/../examples/haystack/example.py#snippet

Keep `/v1` in `api_base_url`. `api_key` takes a `Secret`; pass `Secret.from_token(...)` explicitly so the plugboard key is used rather than `OPENAI_API_KEY`.

## What works

Text in pipelines, streaming with `streaming_callback`, and tool calls with `Tool` (send the result back with `ChatMessage.from_tool(..., origin=call)`).

## Limits

- Streamed answers carry no token counts unless you request them: add `generation_kwargs={"stream_options": {"include_usage": True}}`.
