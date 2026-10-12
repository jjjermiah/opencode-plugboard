# OpenAI Python SDK against plugboard

> Historical record of one run at `3fcedc7`, before the later refactors. Superseded since: `GET /v1/models/{id}` is implemented (the `models.retrieve` 404 below is fixed, [#9](https://github.com/jjjermiah/opencode-plugboard/issues/9)), and the reasoning token observation was addressed by the usage fix in [#10](https://github.com/jjjermiah/opencode-plugboard/issues/10). Re-test on the release commit is tracked in [`release-candidate.md`](release-candidate.md).

- Date / tester: 2026-10-11 / automated run
- Client + exact version(s): `openai` 3.29.0 (Python 3.13), `pydantic` 2.14.1, `httpx` 0.28.1 (no adapter packages)
- Env: compat/py (uv)
- Plugboard commit: 3fcedc7 (dev server hot-reloads; no failures attributable to a reload seen)
- Verdict (README gate = S1 and S2 pass): **PASS** (all S1-S7 pass; one extra probe, `models.retrieve`, 404ed at this commit and has since been implemented)

Script: `compat/py/openai_py.py`. Run through logproxy (port 4047), one pass, ~28 chat requests, no retries needed.
Run: `PLUGBOARD_BASE_URL=... uv run --project compat/py python compat/py/openai_py.py` (`ONLY=S1,S2` filters).

## Scenarios

| # | Scenario | Model | Result | Notes |
|---|---|---|---|---|
| S1 | plain chat | fast | pass | `'pong'`, `finish_reason=stop`, usage incl. `completion_tokens_details.reasoning_tokens=0` and `prompt_tokens_details.cached_tokens=0` parse into typed `CompletionUsage` |
| S1 | same | anthropic/claude-haiku-4-5 | pass | |
| S1 | same | openai/gpt-5.6-luna#low | pass | |
| S2 | tool call + tool-result turn | fast | pass | typed `ChatCompletionMessageFunctionToolCall`; `id` is a bare UUID (not `call_...`), `arguments='{"city":"Paris"}'`; turn 2 (history fed back via `message.model_dump(exclude_none=True)`) says "18°C and cloudy" |
| S2 | same | anthropic/claude-haiku-4-5 | pass | id `toolu_...` passed through |
| S2 | same | openai/gpt-5.6-luna#low | pass | id `call_...` |
| S3 | streaming text (+ include_usage) | fast | pass | `ChatCompletionChunk` objects; role first, `finish_reason=stop`, last chunk `choices=[]` with usage, `[DONE]`. Also passes with the SDK helper `client.chat.completions.stream(...)` + `get_final_completion()` |
| S4 | streaming tool call | fast | pass | one delta with index/id/type/name/full arguments; `finish_reason=tool_calls`; usage chunk. SDK helper `.stream(...)` assembles a typed `tool_calls[0]` (`parsed_arguments=None`, no tool strictness) |
| S5 | image data URL | fast | pass | answer `Red` |
| S5 | same | anthropic/claude-haiku-4-5 | pass | `Red` |
| S5 | same (extra) | openai/gpt-5.6-luna#low | pass | `Red` |
| S6 | structured output | fast | pass | `client.beta.chat.completions.parse(response_format=Meal)` -> `message.parsed` is a `Meal`; also `client.chat.completions.parse` (top-level) and raw `response_format={"type":"json_schema",...}` pass |
| S6 | same | anthropic/claude-haiku-4-5 | pass | parse + raw |
| S6 | same | openai/gpt-5.6-luna#low | pass | parse + raw |
| S7 | list models | n/a | pass | `client.models.list()` parses; `fast`, `anthropic/claude-*`, `*#low` present; `plugboard` object lands in `Model.model_extra`; `shutdown_date: None` also present. Got 387 entries, 0 duplicate ids, all `created: 0` (README said 458 with ~71 duplicates; catalog differs from the README snapshot, not a client problem) |

Extra probes:

| Probe | Result | Notes |
|---|---|---|
| wrong key, chat | pass | `openai.AuthenticationError`, status 401, `e.code='invalid_api_key'`, `type='authentication_error'`, body `{'message': 'Missing or invalid API key', ...}` |
| wrong key, `models.list()` | pass | `AuthenticationError` |
| model `nope`, non-stream | pass | `openai.NotFoundError`, 404, `code='model_not_found'`, `param='model'`, message `Model nope is not available` |
| model `nope`, `stream=True` | pass | `NotFoundError` raised at call time (plain JSON 404, not SSE) |
| `developer` role + `max_completion_tokens` + `reasoning_effort="low"` on fast | pass | `pong` |
| `client.models.retrieve("fast")` | **fail (gap, since implemented)** | `NotFoundError: Error code: 404 - {'error': {'message': 'No route for GET /v1/models/fast', 'type': 'not_found_error', 'param': None, 'code': 'not_found'}}` |

## Failures (exact error text)

Only `models.retrieve` (not in S1-S7):
`openai.NotFoundError: Error code: 404 - {'error': {'message': 'No route for GET /v1/models/fast', 'type': 'not_found_error', 'param': None, 'code': 'not_found'}}`

## Suspected plugboard bugs

1. **(Superseded: implemented.) `GET /v1/models/{id}` not implemented at this commit** (plugboard gap, low severity). Raw request: `GET /v1/models/fast` with the valid Bearer key. Raw response: `404 {"error":{"message":"No route for GET /v1/models/fast","type":"not_found_error","param":null,"code":"not_found"}}` (2026-10-11 ~16:16 EDT). Some clients (e.g. UIs that validate a configured model) call this. Note ids containing `/` and `#` would need path handling (`anthropic/claude-haiku-4-5`, `...#low`; the SDK percent-encodes them).

2. **Reasoning-like text inside streamed content on `fast`** (probably model behaviour; unverified). One of three streamed `Reply with exactly: pong` runs (include_usage, `fast`) returned content deltas `User wants exactly "pong".pong` in a single delta. The other two returned `pong`. Non-stream S1 always returned `pong`. `src/openai/response.ts:158` drops `reasoning-delta` events, so this text appears to come from the model as a `text` part, not from a leaked reasoning part. Raw response (logproxy row 10, 2026-10-11 ~16:16:11 EDT):
   ```
   data: {"id":"chatcmpl-930a...","object":"chat.completion.chunk","created":1791749771,"model":"fast","choices":[{"index":0,"delta":{"role":"assistant","content":""},...}]}
   data: {...,"choices":[{"index":0,"delta":{"content":"User wants exactly \"pong\".pong"},"finish_reason":null,"logprobs":null}],"usage":null}
   data: {...,"choices":[{"index":0,"delta":{},"finish_reason":"stop",...}]}
   data: {...,"choices":[],"usage":{"prompt_tokens":17,"completion_tokens":10,"total_tokens":27,"prompt_tokens_details":{"cached_tokens":0},"completion_tokens_details":{"reasoning_tokens":0}}}
   data: [DONE]
   ```
   My S3 check only requires `pong` as a substring, so it passed. Worth checking whether backend.ts ever forwards reasoning as text for this provider; not reproduced further (one sample).

No other bugs. Observations (not bugs): tool call ids from `fast` are bare UUIDs; `reasoning_tokens` is `0` even where `fast` reasons ("reasons a little" per README); `model` in responses echoes the requested alias (`fast`).

## What the client actually sends (notable fields)

- `User-Agent: OpenAI/Python 3.29.0`, `x-stainless-*` headers; `Authorization: Bearer`.
- Plain `create`: only `model`, `messages` (plus `tools`, `stream`, `stream_options`, `response_format` when given). No `max_tokens`, `parallel_tool_calls`, `tool_choice` or `temperature` by default.
- `.parse(response_format=Meal)`: adds an explicit `"stream": false` and sends `response_format={"type":"json_schema","json_schema":{"name":"Meal","strict":true,"schema":{...,"additionalProperties":false,"title":"Meal",...}}}` (Pydantic adds `title` keys; accepted by every model tested).
- S2 turn 2: assistant message from `model_dump(exclude_none=True)` carries `tool_calls` and no `content` key (null content omitted); plugboard accepted it.
- `stream_options: {"include_usage": true}`; for `.stream()` helper the same plus `stream: true`.
- `developer` role message, `max_completion_tokens`, `reasoning_effort` sent as-is when requested; plugboard accepted all.

## Notes / follow-ups

- Session cleanup: 25 `compat` sessions were deleted, matched by timestamp, model and prompt against the proxy log. Sessions carried no request id and the app was shared with concurrent runs, so a coincidental match with another run's identical prompt at the same second was possible (completed history only).
- Follow-up at the time: add `GET /v1/models/{id}` (done since). The reasoning-in-content sample on `fast` was not reproduced.
- Raw traffic: `compat/traffic/openai-python.jsonl` (gitignored).

Scripts committed under: `compat/py/openai_py.py`
