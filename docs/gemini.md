# Gemini API

`POST /v1beta/models/{model}:generateContent` and `:streamGenerateContent` (with `?alt=sse`, or without it for a JSON array) are served next to Chat Completions, with the same keys, model ids, aliases and limits. Use them when a client only speaks Google's Gemini API: the Google GenAI SDKs (`@google/genai`, `google-genai`), tools built on them, or plain REST calls. Setup guides are under [clients](clients/google-genai-js.md).

Plugboard is stateless here: every request carries the whole conversation in `contents`. Nothing is stored.

```ts
import { GoogleGenAI } from "@google/genai"

const ai = new GoogleGenAI({ apiKey: process.env.PLUGBOARD_KEY, httpOptions: { baseUrl: "http://localhost:4010" } })
const r = await ai.models.generateContent({ model: "fast", contents: "Reply with exactly: pong" })
console.log(r.text)
```

The base URL has no `/v1beta`: the SDK adds it. With the REST API directly, use curl and `jq`. `ORIGIN` is `http://127.0.0.1:4010` and `PLUGBOARD_KEY` is your key. `post` takes the model and a JSON body:

<<< @/../examples/curl/gemini.sh#snippet

<<< @/../examples/curl/gemini.sh#snippet-s1

## Model names

The `{model}` segment is an alias or a plugboard id, percent-decoded:

| Path segment | Resolves to |
| --- | --- |
| `fast` | the alias `fast` (recommended) |
| `openai/gpt-5.6-luna` | provider and model, with a literal `/` (the SDKs send it this way) |
| `openai%2Fgpt-5.6-luna%23low` | the same id with a variant, fully encoded |
| `ollama/llama3:8b` | ids with a colon work: only the text after the last `:` is the method |
| `models/fast` | the `models/` prefix a client may add is dropped |

Use aliases. A `#variant` cannot be sent through an SDK (the URL it builds treats `#` as a fragment), and a name with `/` or `:` is awkward in other tools. The Vercel AI SDK's Google provider also drops the `models/` prefix for an id with a `/`, so send it as `%2F` there. Define an alias per model and variant in the plugboard `aliases` option and give clients that name.

`GET /v1beta/models` lists the same ids and aliases as `/v1/models`, as `models/<id>`; `GET /v1beta/models/{model}` returns one. Everything is on one page (`pageSize` and `pageToken` are ignored). `inputTokenLimit` is the model's context limit when known.

## Authentication

With `keys` configured, the key is read from the first of: the `Authorization: Bearer` header, the `x-goog-api-key` header, the `key` query parameter. The Gemini SDKs send `x-goog-api-key`. Prefer a header: query strings end up in proxy and access logs. Plugboard never logs the URL (only a route label), but anything in front of it might. These key sources apply to Gemini routes only; `/v1/...` takes the `Authorization` header alone.

## What is supported

| Request field | How it is handled |
| --- | --- |
| `contents` | `role` `user` and `model` (`function` is read as `user`). Parts: `text`, `inlineData` (images and files, base64), `fileData` with an `http(s)` `fileUri` or a stored file (`files/<id>`, or the `uri` an upload returned: see [Files API](files.md)), `functionCall` (model turn), `functionResponse` (user turn). Every field is read in camelCase and in snake_case (`inline_data`, `mime_type`, `file_uri`, `function_call`, `function_response`), the way the Python SDK sends them. `inlineData.data` may be standard or URL-safe base64 (`-` and `_`, which the Python SDK sends for bytes); it is normalised to standard base64 before the image check. Thought parts and signature-only parts are dropped. Consecutive model turns are joined (an SDK chat replays a stream as one turn per chunk). |
| `systemInstruction` | The system prompt. A string or a content with text parts. |
| `tools` | `functionDeclarations`. `parameters` is converted from Gemini's schema to JSON Schema: `OBJECT` becomes `object`, `nullable` becomes a `null` type, `"minItems": "1"` becomes a number, and Gemini-only keys (`example`, `propertyOrdering`, formats such as `int32`) are dropped. `parametersJsonSchema` is used as is. A declaration with no parameters takes no arguments. |
| `toolConfig.functionCallingConfig` | `mode` `AUTO` is `auto`, `NONE` is `none`, `ANY` is `required`. `allowedFunctionNames` narrows the tools offered; `ANY` with one name forces that tool. `VALIDATED` is read as `AUTO`. |
| `generationConfig` | `temperature`, `topP`, `topK`, `seed`, `maxOutputTokens`, `presencePenalty`, `frequencyPenalty` are passed to the model. `stopSequences` (up to 5) are matched by plugboard on the answer text and not sent to the model. `safetySettings`, `mediaResolution` and similar are accepted and ignored. Sampling parameters a model is known to reject, or whose provider never sends them (`topK` on GitHub Copilot and GPT-5 and 6, `seed` on Claude and GPT-5 and 6), are dropped, as on Chat Completions, and listed in `x-plugboard-dropped-params` (`top_k`, `seed`). |
| `generationConfig.candidateCount` | 1 to `maxChoices` candidates. Each candidate is one model call, as `n` is on Chat Completions: see [Several candidates](#several-candidates). |
| `generationConfig.responseMimeType` | `application/json` without a schema asks for a JSON object (a markdown fence around it is stripped). `text/plain` is the default. |
| `generationConfig.responseSchema`, `responseJsonSchema` | Structured output, by the same mechanism as Chat Completions (a forced `respond` tool unwrapped into the text, see [architecture](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/architecture.md)). A schema that is not an object (an array, a string enum) is carried in one property and unwrapped, so the text is the JSON of the array. Without a respond call the text is taken when it is the JSON the schema asks for (the same small check as Chat Completions), flagged with `x-plugboard-structured-fallback: text` on generateContent; otherwise a 502 in Google's shape, for every finish reason. A stream holds the text back until the turn ends, so a missing answer after streamed text is an error chunk. |
| `generationConfig.thinkingConfig` | `thinkingLevel` (`LOW`, `HIGH`, ...) picks the model variant of that name when the model has one and the id carries none; a model without that variant gets the nearest one above it, or its highest one. `thinkingBudget` is mapped to a name: `0` to `none`, up to 1024 to `low`, up to 8192 to `medium`, more to `high` (`-1`, dynamic, picks nothing). Otherwise ignored. `includeThoughts` is ignored and no thought parts are returned. |
| `stream` | The method decides: `streamGenerateContent`. `?alt=sse` streams SSE; without `alt` (or with `alt=json`) the stream is a JSON array. Another `alt` is a 400. |

## What is refused

A 400 `INVALID_ARGUMENT` whose message and `details.fieldViolations` name the field:

| Request | Why |
| --- | --- |
| `tools` other than `functionDeclarations`: `googleSearch`, `googleSearchRetrieval`, `codeExecution`, `urlContext`, `retrieval`, `fileSearch`, `googleMaps`, `computerUse` | They run on Google's servers. Plugboard only hands function calls back to you. |
| `candidateCount` above the `maxChoices` cap | See [Several candidates](#several-candidates). |
| `cachedContent` | Needs server-side state. |
| `responseLogprobs`, `responseModalities` other than `TEXT`, `responseMimeType` other than `application/json` and `text/plain` | Not available. |
| `streamGenerateContent` with an `alt` other than `sse` or `json` | Not available. |
| A `functionResponse` that answers no earlier `functionCall`, and a `functionCall` that has no `functionResponse` anywhere in `contents` | The conversation does not add up. |
| Parts plugboard cannot use: `fileData` with a `gs://` URI, `executableCode`, `codeExecutionResult`, `videoMetadata`, `inlineData` in a model turn | Not available. |
| A mode `ANY` tool choice with one allowed function, together with `responseSchema` | Both force the answer's shape. |

A `fileData` that names a `files/<id>` the app has not uploaded is a 404 `NOT_FOUND`. Other methods on a model (`embedContent`, `batchEmbedContents`, ...) get a 404 `NOT_FOUND` too.

## Counting tokens

`:countTokens` answers `{ "totalTokens": N }` with an estimate, built the same way as Anthropic `count_tokens`: see [Messages](messages.md#counting-tokens) for what it counts, the refusals and the side effects. A Gemini model id has its own calibration against `promptTokenCount`: about five characters per token, two thirds of a token per CJK character, and a flat 1090 tokens per image whatever its size. The tokens are the model's own, not a per-tile count.

## Function calls

Gemini function calls carry no id. Plugboard gives each call in `contents` a generated id (`call_0`, `call_1`, ...) and pairs each `functionResponse` with the earliest unanswered call of the same `name`, or with the call that has the same `id` when the client sends one. Parallel calls therefore need their responses in the same order, or distinct names. The model's calls go back without ids, as Google's API does.

A `functionResponse.response` is passed to the model as its JSON text. `{"error": ...}` without `output` marks the result as an error.

## Output

A `GenerateContentResponse` with one candidate: `content.role` `model`, and `parts` in order, text merged into one part and one `functionCall` part (`name`, `args`) per tool call. `finishReason` is `STOP` (also when the model ends on a function call), `MAX_TOKENS` or `SAFETY` (content filter). `usageMetadata` has `promptTokenCount` (including cache reads), `candidatesTokenCount` (without reasoning), `thoughtsTokenCount`, `cachedContentTokenCount` and `totalTokenCount`. `modelVersion` echoes the `{model}` segment. The `x-plugboard-session` header works as on Chat Completions. Reasoning text is not returned.

Errors use Google's body, `{"error": {"code": 400, "message": "...", "status": "INVALID_ARGUMENT"}}`, with `code` the HTTP status and `status` one of `INVALID_ARGUMENT`, `UNAUTHENTICATED`, `PERMISSION_DENIED`, `NOT_FOUND`, `RESOURCE_EXHAUSTED`, `INTERNAL`, `UNAVAILABLE`, `DEADLINE_EXCEEDED`. This applies to every response on a Gemini path, including authentication and body errors.

Any `/v1beta` path is Google's API. An authenticated request to a `/v1beta` path that matches no route gets a 404 `NOT_FOUND` that names the expected `/v1beta/models/{model}:generateContent` shape. A model id with a slash and no `models/` prefix, as the AI SDK and LangChain send it, is one such request. An unauthenticated request gets the 401 first, so the route table stays hidden.

## Streaming

`:streamGenerateContent?alt=sse` sends one `data: {GenerateContentResponse}` frame per piece of output: a text chunk per model text delta, one chunk per tool call, then a final chunk with an empty text part, the `finishReason` and `usageMetadata`. There is no `[DONE]` frame. Nothing is sent until there is output, so a failure before the first token is a real HTTP error; after that, the stream ends with one `data: {"error": {...}}` frame. Reasoning keeps the connection alive with SSE comments, as on the other endpoints.

Tool calls arrive whole from the model, so each is a single chunk holding the full `args`.

### Without `alt=sse`: a JSON array

Without `alt=sse` (or with `alt=json`) the response is `application/json` and the body is one JSON array of the same chunks, written as the model answers: `[`, the first chunk, then `,` and each next chunk, then `]`. The events and the chunks are those of the SSE stream; only the framing differs. A failure before the first chunk is a real HTTP error: the plain error object with its HTTP status, not an array holding it. A failure after it ends the array validly: the error object is the last element, then `]`. Reasoning keeps the connection alive with newlines, which JSON allows between values. The SDKs always send `alt=sse`; this form is for plain REST clients that read the array.

## Several candidates

`generationConfig.candidateCount` above 1 runs plugboard's fan-out, the same as `n` on Chat Completions: one independent model call per candidate, each in its own session, run together. The candidates share no history. The caps are the same: the global `maxChoices` and `apps.<name>.maxN` (default 1). A request above the cap is a 400 `INVALID_ARGUMENT` on `generationConfig.candidateCount`, naming the option, before any model call. The fan-out never reads or fills the [response cache](guides/limits-budgets-and-caching.md).

- **JSON:** one `candidates` array in candidate order, each with its `index` (0 to n-1), and `usageMetadata` summed over the calls, so `promptTokenCount` counts the prompt once per candidate. `x-plugboard-session` lists every session id, comma separated.
- **Stream:** the chunks of the candidates interleave as they arrive, each carrying its `index` and one shared `responseId`; each candidate ends with its own chunk holding `finishReason`. After the last candidate a final chunk with only `usageMetadata` (and `modelVersion`, `responseId`) carries the summed usage. SSE and the JSON array both work.
- **Failure:** if any candidate fails the request fails and the others are cancelled: the HTTP error before output, the error object (the last array element, or one SSE frame) after it. A partial set would look like a complete one.
- **Model version:** `modelVersion` echoes the requested model. With several candidates, an alias with fallbacks does not report the target that answered.
