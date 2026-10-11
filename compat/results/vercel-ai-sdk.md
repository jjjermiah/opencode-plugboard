# Vercel AI SDK against plugboard

> Historical record of one run at `3fcedc7`, before the later refactors. Superseded since: `json_object` is now served with a system instruction (the S6 detail below describes the model's reply to the older mapping; the client still sends no schema, so the keys stay unknown). Re-test on the release commit is tracked in [`release-candidate.md`](release-candidate.md).

- Date / tester: 2026-10-11, automated run
- Client + exact version(s): `ai` 7.0.137, `@ai-sdk/openai-compatible` 3.0.67, `@ai-sdk/openai` 4.0.91, `zod` 4.6.6. User-Agent sent: `ai/7.0.137 ai-sdk-provider-utils/5.0.58 bun/1.4.2`
- Env: compat/js (bun 1.4.2). Script: `compat/js/vercel_ai.ts`. Run: `bun vercel_ai.ts <compat|openai-chat|openai-default> [S1,S2|all] [model,...]`
- Plugboard commit: 3fcedc7
- Verdict (README gate = S1 and S2 pass): **PASS** for `createOpenAICompatible` and for `@ai-sdk/openai` `.chat()`. **FAIL** for the `@ai-sdk/openai` default call `openai(modelId)`, which hits `/v1/responses` (404, plugboard has no such route).

Three provider configurations were run separately, all through logproxy:

- `compat` = `createOpenAICompatible({ name, baseURL, apiKey }).chatModel(id)`
- `openai-chat` = `createOpenAI({ baseURL, apiKey }).chat(id)`
- `openai-default` = `createOpenAI({ baseURL, apiKey })(id)` (what you get without `.chat`)

## Scenarios

Results for `compat` and `openai-chat` are identical unless a note says otherwise.

| # | Scenario | Model | compat | openai-chat | openai-default | Notes |
|---|---|---|---|---|---|---|
| S1 | plain chat (`generateText`) | fast | pass | pass | FAIL (404 /responses) | text `pong`, finish `stop`, usage in/out/total present |
| S1 | same | anthropic/claude-haiku-4-5 | pass | pass | FAIL | |
| S1 | same | openai/gpt-5.6-luna#low | pass | pass | FAIL | |
| S2 | `generateText` + `tools` (zod, `execute`) + `stopWhen: isStepCount(4)` | fast | pass | pass | FAIL | steps `tool-calls>stop`; SDK ran the tool once with `city:"Paris"`, sent turn 2 (`user>assistant>tool`), final text "18°C and cloudy" |
| S2 | same | anthropic/claude-haiku-4-5 | pass | pass | FAIL | tool id `toolu_...` round-trips fine |
| S2 | same | openai/gpt-5.6-luna#low | pass | pass | FAIL | tool id `call_...` |
| S3 | `streamText` + `fullStream` text | fast | pass | pass | FAIL | text `pong`, finish `stop`. With `includeUsage:true` usage populated. See quirks below |
| S4 | `streamText` + tool without `execute` | fast | pass | pass | FAIL | one assembled `tool-call` part: name `get_weather`, input `{city:"Paris"}`, non-empty id, finish `tool-calls`, usage present. Parts: `tool-input-start/delta/end`, `tool-call` |
| S5 | image as message part | fast | pass | pass | FAIL | `fast` accepted the image, answered `Red` |
| S5 | same | anthropic/claude-haiku-4-5 | pass | pass | FAIL | `Red.` |
| S5 | same (extra) | openai/gpt-5.6-luna#low | pass | pass | FAIL | `Red` |
| S6 | `Output.object` (`generateText`) and `generateObject`, zod | fast | **FAIL** | pass | FAIL | see S6 below |
| S6 | same | anthropic/claude-haiku-4-5 | **FAIL** | pass | FAIL | |
| S6 | same | openai/gpt-5.6-luna#low | **FAIL** | pass | FAIL | |
| S6 | same with `supportsStructuredOutputs: true` (extra, compat) | fast / claude-haiku-4-5 / gpt-5.6-luna#low | pass (all three) | n.a. | n.a. | `json_schema` mode, objects valid, no extra keys |
| S7 | list models | n.a. | n.a. in SDK | n.a. | n.a. | The SDK has no model-list call for these providers. Raw `fetch` of `/v1/models` as a cross-check: 200, 387 ids, `fast`, a Claude id and a `#low` id present, 0 duplicate ids, parses fine |
| E1 | error paths | fast | pass | pass | n.a. | see below |
| E2 | `system` + `maxOutputTokens` + `temperature` + reasoning effort | fast | pass | pass | FAIL (404) | |

### S6 detail (compat default)

`createOpenAICompatible` without `supportsStructuredOutputs` sends `response_format: {"type":"json_object"}` and **no schema anywhere** (no schema in a system prompt either). The SDK warns `The feature "responseFormat" is not supported. JSON response format schema is only supported with structuredOutputs`. Plugboard returned valid JSON each time, but the models did not know the keys, so the SDK threw `NoObjectGeneratedError: No object generated: response did not match schema.` Raw contents returned:

- fast: `{"total_calories":"210","estimated_calories":"175","breakdown":{...}}`
- claude-haiku-4-5: `{"response":{"meal":...,"nutritional_breakdown":{...}}}`
- gpt-5.6-luna#low: `{"estimate":"About 240–260 calories total","breakdown":{...},"macros":"..."}`

That is a client behaviour, not a plugboard bug: `json_object` mode was honoured. Fix on the client side: pass `supportsStructuredOutputs: true` (then it sends `json_schema`, shown below and passing on all three models).

`@ai-sdk/openai` `.chat()` always sends `json_schema` (`strict: true`, schema name `response`). Passed on all three models.

Request sent in `json_schema` mode (compat with `supportsStructuredOutputs:true`, and `openai-chat`):

```json
{"model":"fast","response_format":{"type":"json_schema","json_schema":{"schema":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"calories":{"type":"number"},"protein_g":{"type":"number"}},"required":["calories","protein_g"],"additionalProperties":false},"strict":true,"name":"response"}},"messages":[{"role":"user","content":"Estimate: 2 boiled eggs and a slice of toast."}]}
```

Neither `Output.object` nor `generateObject` uses tool mode with these providers. `generateObject` is deprecated in ai v7 (`AISDK_DEP_GENERATE_OBJECT` warning); both paths send the same body.

## Failures (exact error text)

1. `openai-default` (every scenario except S7/E1-wrong-key):
   `APICallError status=404 msg="No route for POST /v1/responses" body={"error":{"message":"No route for POST /v1/responses","type":"not_found_error","param":null,"code":"not_found"}}`
   Request: `POST /v1/responses` `{"model":"fast","input":[{"role":"user","content":[{"type":"input_text","text":"Reply with exactly: pong"}]}]}`. In ai v7 / `@ai-sdk/openai` v4, `openai(id)` is the Responses API model. Plugboard does not implement it. The 404 body is a proper OpenAI-shaped error, so the SDK surfaces it cleanly. Users must write `openai.chat(id)` (or use `createOpenAICompatible`). Wanted or not is a product decision (see follow-ups).
2. `compat` S6 default: `NoObjectGeneratedError: No object generated: response did not match schema.` (explained above, client quirk).

## Suspected plugboard bugs

None found. Raw traffic checked (logproxy, `compat/traffic/vercel-ai.jsonl`, gitignored):

- Non-stream and stream responses parse cleanly in both providers. Streaming tool call comes as one delta with `index`, `id`, `type`, `function.name`, full `arguments`, then `finish_reason: tool_calls`, a `choices: []` usage chunk, `[DONE]`. The SDK assembled it correctly.
- Assistant messages with tool calls go back as `content: null` plus `tool_calls`, and plugboard accepted them (S2 turn 2).
- Observation only: the first stream delta is `{"role":"assistant","content":""}` and every chunk carries `"usage":null` and `"logprobs":null`. Harmless to the AI SDK.
- Observation only: one 404 captured through logproxy shows a duplicated `Date` header (`Sun, 11 Oct 2026 20:18:33 GMT, Sun, 11 Oct 2026 20:18:33 GMT`). Probably the proxy adding its own on top of upstream's. Not verified against the dev server directly.
- Model-assigned tool-call ids differ per call (`chatcmpl-tool-...` from `fast` upstream on one run, a UUID on another). Both worked. Not a bug.

No transient 5xx or reload errors seen.

## What the client actually sends (notable fields)

| Field | `createOpenAICompatible` (compat) | `@ai-sdk/openai` `.chat()` | `@ai-sdk/openai` default |
|---|---|---|---|
| Endpoint | `POST /v1/chat/completions` | `POST /v1/chat/completions` | **`POST /v1/responses`** (body `input[]`, `max_output_tokens`, `input_text` parts) |
| Minimal body | `{model, messages}` only (no `stream`, no `temperature`, no `max_tokens` unless set) | same | `{model, input}` |
| Max tokens | `max_tokens` (when `maxOutputTokens` set; saw `max_tokens: 200`) | `max_tokens` for the non-reasoning id `fast` (unverified, from memory of the SDK source: it switches to `max_completion_tokens` only for ids it recognises as reasoning models; plugboard ids like `openai/gpt-5.6-luna#low` do not match, so it was not observed) | `max_output_tokens` |
| System text | `role: "system"` (E2) | `role: "system"` for `fast` (unverified, from memory of the SDK source: `developer` only for ids it recognises as reasoning models; not observed) | `input` role `system` |
| Reasoning effort | `reasoning_effort` when `providerOptions.<name>.reasoningEffort` set (provider name key) | `reasoning_effort` via `providerOptions.openai` | n.a. |
| `stream_options` | only when `includeUsage: true` → `{"include_usage":true}`. Default: absent, and the stream then has no usage (`usage={}`) | **always** `{"include_usage":true}` when streaming | n.a. |
| `tools` / `tool_choice` | `tools` + `tool_choice: "auto"` | same | n.a. |
| `parallel_tool_calls` | not sent | not sent | n.a. |
| Image | content parts `text` + `image_url` (data URL) | same | n.a. |
| `response_format` | `json_object` by default; `json_schema` (`strict:true`, name `response`) with `supportsStructuredOutputs:true` | `json_schema` always | n.a. |
| Other | `Content-Type`, `Accept: */*`, bearer auth, UA above | same | same |

Also: with `@ai-sdk/openai` `.chat()` the stream of S4 contains an empty `text-start`/`text-end` pair around the tool call (SDK part, not a plugboard issue).

## Error paths (E1)

Both providers surfaced the OpenAI error body correctly through `APICallError`:

- model `nope` → `status=404`, message `Model nope is not available`, body `{"error":{"message":"Model nope is not available","type":"not_found_error","param":"model","code":"model_not_found"}}`.
- wrong key → `status=401`, message `Missing or invalid API key`, body `{"error":{"message":"Missing or invalid API key","type":"authentication_error","param":null,"code":"invalid_api_key"}}`.
- default `openai(id)` with model `nope` gets the `/responses` 404 first, so the model error never shows.

## Notes / follow-ups

- Decide whether plugboard should serve `/v1/responses`. Without it, `@ai-sdk/openai` v4 users must use `.chat()`. Docs should say so (and `createOpenAICompatible` with `supportsStructuredOutputs: true` for structured output).
- Not tested: `developer` role and `max_completion_tokens` (the SDK only emits them for ids it classes as reasoning models, and plugboard's `provider/model#variant` ids do not match), `parallel_tool_calls`, multiple parallel tool calls, tool-choice `required`/named, `streamObject`, embeddings (no such plugboard feature expected).
- Test hygiene: the first `compat` run (27 requests) went through a capture proxy that another run already held on :4031 (port clash), so those requests are in `compat/traffic/langchain.jsonl` (recognisable by the `ai-sdk` user agent). Everything was then re-run through a dedicated proxy on :4071. 63 sessions were deleted, matched by model and creation time (user agent `ai-sdk`); matching by time can catch a session from a concurrent run with the same model, and a few leftover `compat` sessions may remain.
- Reproduce: `cd compat/js && PLUGBOARD_KEY=... bun vercel_ai.ts compat` (then `openai-chat`, `openai-default`). Optional env `PLUGBOARD_BASE_URL`, `FULL=1` (print full request bodies).

Script: `compat/js/vercel_ai.ts`.
