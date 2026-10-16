# Tools, structured output and images

**The problem.** Your app uses more than plain chat: function calling, JSON that matches a schema, images, streaming. You want the usual SDK calls to work, and you want to know where they differ from the real provider API.

## Tools

Plugboard returns the model's tool calls to the caller and never runs them. The caller runs the tool and sends the result back, which is the normal Chat Completions loop.

```json
{"choices": [{"finish_reason": "tool_calls", "message": {"role": "assistant", "tool_calls": [
  {"id": "call_1", "type": "function", "function": {"name": "get_weather", "arguments": "{\"city\": \"Paris\"}"}}]}}]}
```

Send the answer back as a `{"role": "tool", "tool_call_id": "call_1", "content": "..."}` message. Tool call ids differ by model, so do not parse them.

- `maxTools` (default 64) caps the tools one request may carry. Claude Code sends 36.
- `parallel_tool_calls: false` keeps the first call of an answer and drops the rest. The response says so with `x-plugboard-parallel-tools: limited`.
- To let OpenCode run a tool on the server instead, an app can list it in `serverTools`. This gives that app's key real power on the server. Read the warning in the reference first.

## Streaming

Set `stream: true` and read the server-sent events. Ask for usage in the last chunk with `stream_options`.

```sh
curl -N http://127.0.0.1:4010/v1/chat/completions -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "fast", "stream": true, "stream_options": {"include_usage": true},
       "messages": [{"role": "user", "content": "count to three"}]}'
```

If the stream fails after it has started, the client gets an `error` event and then `data: [DONE]`.

## Structured output

`response_format` with `json_schema` returns the JSON as the message content. The model is asked to answer through a `respond` tool. The provider does not enforce the schema, so validate the result.

```sh
curl -s http://127.0.0.1:4010/v1/chat/completions -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" -d '{
    "model": "fast",
    "messages": [{"role": "user", "content": "Extract: Ada, 36, London"}],
    "response_format": {"type": "json_schema", "json_schema": {"name": "person", "schema": {
      "type": "object",
      "properties": {"name": {"type": "string"}, "age": {"type": "integer"}},
      "required": ["name", "age"]}}}
  }' | jq -r '.choices[0].message.content'
```

`json_object` also works, but it carries no schema. Name the keys in the prompt. Anthropic-only clients get the same JSON with a forced tool call: see [structured extraction with a forced tool](../messages.md#structured-extraction-with-a-forced-tool). A request with both `tools` and `json_schema` returns the caller's tool calls, not the schema answer.

## Images

Send images as `data:` URLs, which always work. Plain `http(s)` URLs are fetched by the server only when you allow it.

```jsonc
"remoteImages": { "allow": ["images.internal"], "schemes": ["https"], "maxBytes": 5242880 }
```

With `true` or an `allow` list, the server fetches only public addresses by default and refuses loopback, private, link-local and CGNAT ranges. Turn it on only if you need it, because it makes the server fetch URLs that callers send.

## Several answers with `n`

`n` above 1 returns several answers from one request. Each choice is a full model call, so `n: 3` costs three times as much. `maxN` (default 1) is the cap. Above it the request gets a 400 `too_many_choices`. A single app can have a lower cap: `apps.<name>.maxN`.

## Count tokens before you send

Clients that budget context first, such as Claude Code and the Anthropic and Gemini SDKs, can call `POST /v1/messages/count_tokens` or Gemini `:countTokens`. The count is an estimate, because plugboard has no tokenizer.

## Sampling parameters a model refuses

Some models reject `temperature`, `top_p` or the penalties. Plugboard drops the ones it knows a model refuses, so the request still succeeds, and lists them:

```
x-plugboard-dropped-params: temperature,top_p
```

Set `"dropUnsupportedParams": false` to forward everything as sent.

## Related options

All in the [configuration reference](../configuration.md#tools-structured-output-and-images):

- [`maxTools`](../configuration.md#options) and [the cost of the seed pool](../configuration.md#cost-of-the-seed-pool)
- [`remoteImages` limits](../configuration.md#remote-image-limits-since-0-26-0)
- [Request fields and behaviours](../configuration.md#request-fields-and-behaviours)
- `maxN`, `dropUnsupportedParams`
- Per-endpoint detail: [Chat Completions](../chat-completions.md), [Responses](../responses.md), [Messages](../messages.md), [Gemini](../gemini.md), [Completions and `n`](../completions.md)

Next: [History, usage and monitoring](history-usage-and-monitoring.md).
