# LangChain (Python `langchain-openai` + JS `@langchain/openai`) against plugboard

> Historical record of one run at `3fcedc7`, before the later refactors. Superseded since: `json_object` is no longer a forced `respond` tool but a system instruction (observation 2), and the usage accounting inconsistency was fixed in [#10](https://github.com/jjjermiah/opencode-plugboard/issues/10) (observation 3). The `/v1/responses` gap (observation 1) still stands. Re-test on the release commit is tracked in [`release-candidate.md`](release-candidate.md).

- Date / tester: 2026-10-11 / automated run (LangChain)
- Client + exact version(s):
  - Python: `langchain-openai` 1.7.0, `langchain-core` 1.6.9, `openai` 3.29.0, `httpx` 0.28.1, `pydantic` 2.14.1
  - JS: `@langchain/openai` 1.6.2, `@langchain/core` 1.2.17, `openai` 7.32.0, `zod` 4.6.6 (bun 1.4.2)
- Env: `compat/py` (uv, Python 3.13) and `compat/js` (bun)
- Plugboard commit: `3fcedc7` (dev server hot-reloads; no transient 5xx seen during the runs)
- Verdict (S1 and S2 pass): **PASS** for Python: every scenario passed on every model, but `json_mode` on `fast` passed on a single sample (it returned `{}` in JS and curl). **PARTIAL** for JS: JS `ChatOpenAI` forces the Responses API for ids containing `gpt-5.6` and plugboard has no `/v1/responses` route, and `json_mode` on `fast` returned `{}`.

Scripts: `compat/py/langchain_py.py`, `compat/js/langchain_js.ts`. Both take scenario names (`S1 S2 S3 S4 S5 S6 S7 S1x ERR`; JS also `GPTALT`) and read `PLUGBOARD_BASE_URL` / `PLUGBOARD_KEY`.
Raw traffic (gitignored): `compat/traffic/langchain.jsonl` (Python; **mixed with another run's traffic**, which used the same proxy port 4031, so filter by `user-agent` and body) and `compat/traffic/langchain-js.jsonl` (JS, clean, port 4067).

## Scenarios

Responses API kept off with `use_responses_api=False` (Py) / `useResponsesApi: false` (JS) on every call. All requests below went to `/v1/chat/completions`, except where noted.

| # | Scenario | Model | Python | JS | Notes |
|---|---|---|---|---|---|
| S1 | plain chat | fast | pass | pass | `finish_reason` stop, `usage_metadata` filled |
| S1 | same | anthropic/claude-haiku-4-5 | pass | pass | |
| S1 | same | openai/gpt-5.6-luna#low | pass | **fail (client quirk)** | JS sends `POST /v1/responses` -> 404 (see Failures). Py ok |
| S2 | tool call + tool-result turn | fast | pass | pass | `tool_calls=[{name:get_weather,args:{city:Paris},id:<uuid>}]`, turn 2 "18°C and cloudy" |
| S2 | same | anthropic/claude-haiku-4-5 | pass | pass | id `toolu_...` |
| S2 | same | openai/gpt-5.6-luna#low | pass | **fail (client quirk)** | same `/v1/responses` 404 in JS. JS with `openai/gpt-5.5#low` passes |
| S3 | streaming text (+ include_usage) | fast | pass | pass | 4-5 chunks, text `pong`, final `usage_metadata` correct, `finish_reason` stop; also ok with `stream_usage=False` (Py) |
| S4 | streaming tool call | fast | pass | pass | one `tool_call_chunk` (name+whole args), aggregates to correct `tool_calls`, `finish_reason` tool_calls; the aggregated chunk fed back as the assistant message with a `ToolMessage` gives a correct turn 2 |
| S5 | image data URL | fast | pass | pass | answers "Red"; both `image_url` part and standard `{type:"image", base64,...}` block (LangChain converts to `image_url`) |
| S5 | same | anthropic/claude-haiku-4-5 | pass | pass | "Red" |
| S5 | same | openai/gpt-5.6-luna#low | pass | fail (client quirk) | extra check, not required. JS ok on `openai/gpt-5.5#low` |
| S6 | `with_structured_output` `json_schema` | fast | pass | pass | |
| S6 | `function_calling` | fast | pass | pass | forced `tool_choice` on tool `Meal`, parsed OK |
| S6 | `json_mode` | fast | pass (1 sample) | **fail (model behaviour)** | content `{}`, see Suspected bugs #2. Not plugboard-routing related |
| S6 | all three methods | anthropic/claude-haiku-4-5 | pass | pass | |
| S6 | all three methods | openai/gpt-5.6-luna#low | pass | fail (client quirk) | JS 404 on `/v1/responses`; JS on `openai/gpt-5.5#low` passes all three |
| S7 | list models | n/a | pass | pass | LangChain has **no list-models API** (n.a.); listed through the wrapped OpenAI SDK client (`ChatOpenAI.root_client` in Py, `openai` SDK in JS). 387 ids, 0 duplicates, `fast`, Claude and `#low` ids present, extra `plugboard` field tolerated |
| ERR | bad key / bad model | n/a | pass | pass | 401 `invalid_api_key` -> `OpenAIAuthenticationError`; 404 `model_not_found` -> `OpenAIModelNotFoundError` with body text surfaced (JS: `Error 401/404` plus the message and a LangChain troubleshooting URL) |

## Failures (exact error text)

JS, any model id containing `gpt-5.6` (here `openai/gpt-5.6-luna#low`), even with `useResponsesApi: false`:

```
Error: 404 No route for POST /v1/responses

Troubleshooting URL: https://docs.langchain.com/oss/javascript/langchain/errors/MODEL_NOT_FOUND/
```

JS `json_mode` on `fast`: no exception from the client; the model returned `{}`, so `parsed` was null (my script asserted numeric keys).

## Suspected plugboard bugs

None blocking. Observations, most likely first:

1. **Client quirk, but with a plugboard gap behind it: no `/v1/responses` route.** `@langchain/openai` 1.6.2 `_modelPrefersResponsesAPI` (`dist/utils/misc.js:89`) returns true for ids containing `gpt-5.6`, `gpt-5.2-pro`, `gpt-5.4-pro`, `gpt-5.5-pro` or `codex`, and `_useResponsesApi` ORs that in, so `useResponsesApi: false` is ignored. Python only matches by **prefix** (`startswith(_RESPONSES_API_ONLY_PREFIXES)`) and honours an explicit `use_responses_api=False`, so `openai/gpt-5.6-luna#low` is fine there, but a bare `gpt-5.6-...` id would auto-switch in Python too if the flag is left unset (default `None`). Any LangChain user of the ChatGPT models via plugboard hits this unless the id is prefixed or Responses is served. Raw (time 2026-10-11 ~16:18 local):
   - request `POST /v1/responses` `{"input":[{"type":"message","role":"user","content":"Reply with exactly: pong"}],"model":"openai/gpt-5.6-luna#low","stream":false,"text":{}}`
   - response 404 `{"error":{"message":"No route for POST /v1/responses","type":"not_found_error","param":null,"code":"not_found"}}`
   The 404 body is OpenAI-shaped, good. Decision for plugboard: document the workaround (use the `openai/` prefix is not enough in JS; pass a model id without `gpt-5.6`, or use Python) or add a Responses route. I did not verify whether a Responses route is in scope.
2. **(Superseded: `json_object` now uses a system instruction, not the `respond` tool.) Model behaviour, with a design weak spot: `response_format: {"type":"json_object"}` on `fast`.** At `3fcedc7` plugboard mapped `json_object` to a forced `respond` tool with `{type:object, additionalProperties:true}` (`src/openai/request.ts:182`), so the model sees no key names except in the prompt. `fast` returned `{}` 4 of 4 times for the same prompt in JS and curl, while Python got `{"calories":"220","protein_g":"15"}` once (strings, not numbers; pydantic coerced). A request on `fast` from a concurrent run without a key hint got `{"actual_response":"..."}`. Claude and gpt-5.x answered correctly. Raw: request `{"model":"fast","stream":false,"response_format":{"type":"json_object"},"messages":[{"role":"user","content":"Estimate: 2 boiled eggs and a slice of toast. Respond as JSON with keys calories and protein_g (numbers)."}]}` -> `"message":{"content":"{}"},"finish_reason":"stop"`, usage `prompt 182, completion 200`. Note `prompt_tokens` 182 for a ~25-token prompt (plugboard adds about 150 tokens of tool/system scaffolding for any `response_format`).
3. **(Superseded: fixed in #10.) Minor: usage accounting is inconsistent for reasoning models.** Same prompt `Reply with exactly: pong` on `fast`:
   - Py, non-stream: `"usage":{"prompt_tokens":17,"completion_tokens":3,"total_tokens":20,"completion_tokens_details":{"reasoning_tokens":64}}` -> reasoning (64) larger than completion (3) and not in total.
   - JS, non-stream: `completion_tokens 83`, `reasoning_tokens 0` for the same visible `pong`.
   - streaming: `reasoning_tokens 0` with `completion_tokens` 3 (Py) / 47 (JS).
   LangChain just reports what it gets (`output_token_details.reasoning`), so nothing breaks, but the numbers are not comparable between runs. Likely the provider reports reasoning differently; could be plugboard's mapping of the final usage. Not verified in plugboard code.

No other bug: no schema leaks, no 5xx, `finish_reason`, ids and SSE framing all parse.

## What the client actually sends (notable fields)

- Both clients: `POST /v1/chat/completions`, `stream: false` explicit for `invoke` in the stable path; streaming adds `stream: true` and `stream_options: {"include_usage": true}` when `stream_usage=True` / `streamUsage: true`; `stream_usage=False` (Py) sent no `stream_options`. I always set it explicitly, so the default behaviour with a custom base URL is untested.
- No `max_tokens` / `max_completion_tokens` by default; no `developer` role; no `reasoning_effort` unless set.
- `bind_tools`: `tools:[{type:function,function:{name,description,parameters}}]`, `tool_choice:"auto"` shown on some Py requests (bind_tools default); `parallel_tool_calls` not sent except `false` with `with_structured_output(method="function_calling")` together with `tool_choice:{"type":"function","function":{"name":"Meal"}}`.
- `with_structured_output(method="json_schema")`: `response_format:{"type":"json_schema","json_schema":{"name":"Meal","schema":{... "additionalProperties":false},"strict":true}}` (Py; JS shape similar with `strict:true`, `name:"response"` unless named).
- `json_mode`: `response_format:{"type":"json_object"}`.
- ToolMessage turn: `{"role":"tool","tool_call_id":"<id>","content":"<json string>"}` and the assistant message with `tool_calls` (arguments JSON string, `content` empty). Plugboard accepted both the `fast` UUID ids and `toolu_`/`call_` ids unchanged.
- Python's `openai` user agent `OpenAI/Python 3.29.0`; JS user agent not set by the SDK path (bun).
- Extra response fields (`usage:null` in non-final stream chunks, `logprobs:null`, `refusal:null`, first delta `content:""`) were all tolerated.

## Notes / follow-ups

- Sessions from this run were not deleted: session metadata had no client id, and concurrent runs used the same `compat` app, models and prompts, so they could not be attributed. Responses now carry `x-plugboard-session`.
- Another run's proxy shared port 4031, so `langchain.jsonl` has foreign traffic; `langchain-js.jsonl` is clean.
- Not tested: JS `use_responses_api` against a future `/v1/responses`, multi-tool parallel calls, async clients, `with_structured_output` with strict `json_schema` on nested schemas, the `reasoning` kwarg.

Scripts: `compat/py/langchain_py.py`, `compat/js/langchain_js.ts`.
