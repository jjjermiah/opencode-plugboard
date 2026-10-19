# Google GenAI JS SDK

The official `@google/genai` package, on plugboard's [Gemini API](../gemini.md).

## Connect

The SDK adds `/v1beta` itself, so the base URL is the plugboard origin:

```ts
import { GoogleGenAI } from "@google/genai"

const ai = new GoogleGenAI({ apiKey: process.env.PLUGBOARD_KEY, httpOptions: { baseUrl: "http://127.0.0.1:4010" } })
```

## Chat

<<< @/../examples/gemini-js/chat.ts#snippet

## Tool calls

Gemini calls carry no id: the function name pairs a `functionResponse` with its call.

<<< @/../examples/gemini-js/tools.ts#snippet

## Streaming

<<< @/../examples/gemini-js/stream.ts#snippet

A streamed tool call arrives whole, in one chunk with its full `args`:

<<< @/../examples/gemini-js/stream_tools.ts#snippet

## Images

<<< @/../examples/gemini-js/image.ts#snippet

## Structured output

Pass a JSON schema as `responseJsonSchema` with `responseMimeType: "application/json"`:

<<< @/../examples/gemini-js/structured.ts#snippet

## Files

`ai.files.upload({ file: "doc.pdf" })` uploads through plugboard; pass the returned file's `uri` in a `fileData` part. See [Files](../files.md).

## Model names

A `#` in a model name must be sent as `%23` (`openai/gpt-5.6-luna%23low`); a `/` goes as it is. Aliases avoid both. See [Gemini model names](../gemini.md#model-names).

## Limits

- A wrong key or an unknown model throws `ApiError` with the HTTP status; the body names Google's status (`UNAUTHENTICATED`, `NOT_FOUND`).
- Gemini reports `STOP` on a turn with a function call too; check the parts for a `functionCall`.
- The schema in structured output is not enforced by the provider. Validate the answer.
