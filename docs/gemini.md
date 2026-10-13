# Gemini API

`POST /v1beta/models/{model}:generateContent` and `:streamGenerateContent?alt=sse` are served next to Chat Completions, with the same keys, model ids, aliases and limits. Use them when a client only speaks Google's Gemini API: the Google GenAI SDKs (`@google/genai`, `google-genai`), tools built on them, or plain REST calls.

Plugboard is stateless, as on the other endpoints: every request carries the whole conversation in `contents`. Nothing is stored.

Tested, 2026-10-11, `@google/genai` 2.28.0 (JS SDK): against a fake model caller (plain, streamed and function-calling chat, JSON output, image input, `models.list` and `models.get`, errors, `apiVersion: "v1"`), and live on OpenCode 2.0.26 with `opencode-go/glm-5.3-flash` (alias `fast`), `anthropic/claude-haiku-5-5` and `openai/gpt-5.6-luna%23low`: text, stream, a function-calling round trip, JSON schema, parallel calls in a stream and in `ai.chats`, and an array schema. Not run with the Python SDK or the Gemini CLI.

```ts
import { GoogleGenAI } from "@google/genai"

const ai = new GoogleGenAI({ apiKey: process.env.PLUGBOARD_KEY, httpOptions: { baseUrl: "http://localhost:4010" } })
const r = await ai.models.generateContent({ model: "fast", contents: "Reply with exactly: pong" })
console.log(r.text)
```

The base URL has no `/v1beta`: the SDK adds it. With the REST API directly:

```sh
curl -s "http://localhost:4010/v1beta/models/fast:generateContent" \
  -H "x-goog-api-key: $PLUGBOARD_KEY" -H "content-type: application/json" \
  -d '{"contents":[{"role":"user","parts":[{"text":"Reply with exactly: pong"}]}]}'
```

## Model names

The `{model}` segment is an alias or a plugboard id, percent-decoded:

| Path segment | Resolves to |
| --- | --- |
| `fast` | the alias `fast` (recommended) |
| `openai/gpt-5.6-luna` | provider and model, with a literal `/` (the SDKs send it this way) |
| `openai%2Fgpt-5.6-luna%23low` | the same id with a variant, fully encoded |
| `ollama/llama3:8b` | ids with a colon work: only the text after the last `:` is the method |
| `models/fast` | the `models/` prefix a client may add is dropped |

Use aliases. A `#variant` cannot be sent through an SDK (the URL it builds treats `#` as a fragment), and a name with `/` or `:` is awkward in other tools. Define an alias per model and variant in the plugboard `aliases` option and give clients that name.

`GET /v1beta/models` lists the same ids and aliases as `/v1/models`, as `models/<id>`; `GET /v1beta/models/{model}` returns one. Everything is on one page (`pageSize` and `pageToken` are ignored). `inputTokenLimit` is the model's context limit when known.

## Authentication

With `keys` configured, the key is read from the first of: the `Authorization: Bearer` header, the `x-goog-api-key` header, the `key` query parameter. The Gemini SDKs send `x-goog-api-key`. Prefer a header: query strings end up in proxy and access logs. Plugboard never logs the URL (only a route label), but anything in front of it might. These key sources apply to Gemini routes only; `/v1/...` still takes the `Authorization` header alone.

## What is supported

| Request field | How it is handled |
| --- | --- |
| `contents` | `role` `user` and `model` (`function` is read as `user`). Parts: `text`, `inlineData` (images and files, base64), `fileData` with an `http(s)` `fileUri`, `functionCall` (model turn), `functionResponse` (user turn). Thought parts and signature-only parts are dropped. Consecutive model turns are joined (an SDK chat replays a stream as one turn per chunk). |
| `systemInstruction` | The system prompt. A string or a content with text parts. |
| `tools` | `functionDeclarations`. `parameters` is converted from Gemini's schema to JSON Schema: `OBJECT` becomes `object`, `nullable` becomes a `null` type, `"minItems": "1"` becomes a number, and Gemini-only keys (`example`, `propertyOrdering`, formats such as `int32`) are dropped. `parametersJsonSchema` is used as is. A declaration with no parameters takes no arguments. |
| `toolConfig.functionCallingConfig` | `mode` `AUTO` is `auto`, `NONE` is `none`, `ANY` is `required`. `allowedFunctionNames` narrows the tools offered; `ANY` with one name forces that tool. `VALIDATED` is read as `AUTO`. |
| `generationConfig` | `temperature`, `topP`, `maxOutputTokens`, `stopSequences` (up to 5), `presencePenalty`, `frequencyPenalty` are passed to the model. `topK`, `seed`, `safetySettings`, `mediaResolution` and similar are accepted and ignored. Sampling parameters a model is known to reject are dropped, as on Chat Completions, and listed in `x-plugboard-dropped-params`. |
| `generationConfig.candidateCount` | `1` only. |
| `generationConfig.responseMimeType` | `application/json` without a schema asks for a JSON object (a markdown fence around it is stripped). `text/plain` is the default. |
| `generationConfig.responseSchema`, `responseJsonSchema` | Structured output, by the same mechanism as Chat Completions (a forced `respond` tool unwrapped into the text, see [architecture](architecture.md)). A schema that is not an object (an array, a string enum) is carried in one property and unwrapped, so the text is the JSON of the array. Without a respond call the text is taken when it is the JSON the schema asks for (#173, the same small check as Chat Completions), flagged with `x-plugboard-structured-fallback: text` on generateContent; otherwise a 502 in Google's shape, for every finish reason. A stream holds the text back until the turn ends, so a missing answer after streamed text is an error chunk. |
| `generationConfig.thinkingConfig` | `thinkingLevel` (`LOW`, `HIGH`, ...) picks the model variant of that name when the model has one and the id carries none. `thinkingBudget` is mapped to a name: `0` to `none`, up to 1024 to `low`, up to 8192 to `medium`, more to `high` (`-1`, dynamic, picks nothing). Otherwise ignored. `includeThoughts` is ignored and no thought parts are returned. |
| `stream` | The method decides: `streamGenerateContent`, and it needs `?alt=sse`. |

## What is rejected

A 400 `INVALID_ARGUMENT` whose message and `details.fieldViolations` name the field:

- `tools` other than `functionDeclarations`: `googleSearch`, `googleSearchRetrieval`, `codeExecution`, `urlContext`, `retrieval`, `fileSearch`, `googleMaps`, `computerUse`. They run on Google's servers; plugboard only hands function calls back to you.
- `candidateCount` above 1, `cachedContent` (needs server-side state), `responseLogprobs`, `responseModalities` other than `TEXT`, `responseMimeType` other than `application/json` and `text/plain`.
- `streamGenerateContent` without `alt=sse` (the JSON-array form is not implemented).
- A `functionResponse` that answers no earlier `functionCall`, and a `functionCall` that has no `functionResponse` anywhere in `contents`.
- Parts plugboard cannot use: `fileData` with a Gemini file id or `gs://` URI, `executableCode`, `codeExecutionResult`, `videoMetadata`, `inlineData` in a model turn.

`countTokens` answers `{ "totalTokens": N }` with the same estimate as Anthropic `count_tokens` (characters / 4 plus a fixed cost per image or file), built the same way: the app's `system` policy and the tool-choice steering, the agent prompt or skill content of the model, and the schemas of `serverTools` (see [Messages](messages.md) for the details, the refusals and the side effects of a count). Other methods on a model (`embedContent`, `batchEmbedContents`, ...) get a 404 `NOT_FOUND`. A mode `ANY` tool choice with one allowed function cannot be combined with `responseSchema`.

## Function calls

Gemini function calls carry no id. Plugboard gives each call in `contents` a generated id (`call_0`, `call_1`, ...) and pairs each `functionResponse` with the earliest unanswered call of the same `name`, or with the call that has the same `id` when the client sends one. Parallel calls therefore need their responses in the same order, or distinct names. The model's calls go back without ids, as Google's API does.

A `functionResponse.response` is passed to the model as its JSON text. `{"error": ...}` without `output` marks the result as an error.

## Output

A `GenerateContentResponse` with one candidate: `content.role` `model`, and `parts` in order, text merged into one part and one `functionCall` part (`name`, `args`) per tool call. `finishReason` is `STOP` (also when the model ends on a function call), `MAX_TOKENS` or `SAFETY` (content filter). `usageMetadata` has `promptTokenCount` (including cache reads), `candidatesTokenCount` (without reasoning), `thoughtsTokenCount`, `cachedContentTokenCount` and `totalTokenCount`. `modelVersion` echoes the `{model}` segment. The `x-plugboard-session` header works as on Chat Completions. Reasoning text is not returned.

Errors use Google's body, `{"error": {"code": 400, "message": "...", "status": "INVALID_ARGUMENT"}}`, with `code` the HTTP status and `status` one of `INVALID_ARGUMENT`, `UNAUTHENTICATED`, `PERMISSION_DENIED`, `NOT_FOUND`, `RESOURCE_EXHAUSTED`, `INTERNAL`, `UNAVAILABLE`, `DEADLINE_EXCEEDED`. This applies to every response on a Gemini path, including authentication and body errors. Any `/v1beta` path is Google's API: an authenticated request to a `/v1beta` path that matches no route (for example a model id with a slash and no `models/` prefix, as the AI SDK and LangChain send it) gets a 404 `NOT_FOUND` that names the expected `/v1beta/models/{model}:generateContent` shape. An unauthenticated request gets the 401 first, so the route table stays hidden.

## Streaming

`:streamGenerateContent?alt=sse` sends one `data: {GenerateContentResponse}` frame per piece of output: a text chunk per model text delta, one chunk per tool call, then a final chunk with an empty text part, the `finishReason` and `usageMetadata`. There is no `[DONE]` frame. Nothing is sent until there is output, so a failure before the first token is a real HTTP error; after that, the stream ends with one `data: {"error": {...}}` frame. Reasoning keeps the connection alive with SSE comments, as on the other endpoints.

Tool calls arrive whole from the model, so each is a single chunk holding the full `args`.
