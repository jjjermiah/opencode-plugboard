# OpenAI JS SDK

The official `openai` package for Node, Bun and Deno. It works with plugboard on both Chat Completions and the Responses API.

## Connect

```ts
import OpenAI from "openai"

const client = new OpenAI({ baseURL: "http://127.0.0.1:4010/v1", apiKey: process.env.PLUGBOARD_KEY })
```

`model` is an alias from your `aliases` option, such as `"fast"`, or any allowed `provider/model[#variant]`.

## Chat

<<< @/../examples/openai-js/chat.ts#snippet

## Tool calls

Plugboard returns the call. Your code runs the tool and sends the result back. `client.chat.completions.runTools` also works.

<<< @/../examples/openai-js/tools.ts#snippet

## Structured output

`zodResponseFormat(Meal, "meal")` with `.parse()` or `.stream()` fills `message.parsed`:

<<< @/../examples/openai-js/structured.ts#snippet-parse

## Responses API

Text:

<<< @/../examples/openai-js/chat.ts#snippet-responses

Tool calls. `responsesTool` is the tool in the Responses shape (name at the top level). With `store: false` you send the whole history in `input`; with the default you can pass `previous_response_id` instead.

<<< @/../examples/openai-js/tools.ts#snippet-responses

Streaming, from `response.output_text.delta` events:

<<< @/../examples/openai-js/stream.ts#snippet-responses

Images, as a data URL:

<<< @/../examples/openai-js/image.ts#snippet-responses

Structured output with `responses.parse` and `zodTextFormat`:

<<< @/../examples/openai-js/structured.ts#snippet-responses

`client.responses.retrieve`, `inputItems.list` and `delete` work on stored responses. See [Responses API](../responses.md).

## Files

`client.files.create({ file: fs.createReadStream("doc.pdf"), purpose: "user_data" })` returns an id you can use in a `file` part (Chat) or an `input_file` part (Responses). See [Files](../files.md).

## Limits

- Streaming usage needs `stream_options: { include_usage: true }`.
- The schema in structured output is not enforced by the provider. Validate the answer.
- A wrong key throws `AuthenticationError` (401). An unknown model throws `NotFoundError` (404).
