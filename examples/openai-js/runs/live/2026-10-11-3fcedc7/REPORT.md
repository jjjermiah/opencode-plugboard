# OpenAI JS/TS SDK against plugboard

> Historical record of one run at `3fcedc7`, before the later refactors. Superseded since: the usage accounting observation below (fixed in [#10](https://github.com/jjjermiah/opencode-plugboard/issues/10)), and the run did not touch `models.retrieve`, which is now implemented. Re-test on the release commit is tracked in [`release-candidate.md`](release-candidate.md).

- Date / tester: 2026-10-11 (run 20:16:14Z to 20:17:05Z), automated run
- Client + exact version(s): `openai` npm 7.32.0 (`User-Agent: OpenAI/JS 7.32.0`), `zod` 4.6.6 (for `openai/helpers/zod`); runtime bun 1.4.2 launching script, SDK reports node v26.3.0 runtime
- Env: compat/js (bun)
- Plugboard commit: 3fcedc7 (the dev server hot-reloads, so the running code may have moved during the run)
- Verdict (README gate = S1 and S2 pass): **PASS**
- Script: `compat/js/openai_js.ts` (`cd compat/js && bun openai_js.ts [S1,S2,...]`). Run through `compat/tools/logproxy.py` on port 4037; log `compat/traffic/openai-js.jsonl` (gitignored). SDK built with `maxRetries: 0`.

## Scenarios

| # | Scenario | Model | Result (pass/fail/n.a.) | Notes |
|---|---|---|---|---|
| S1 | plain chat | fast | pass | finish `stop`, usage has prompt/completion/total (17/36/53) |
| S1 | same (extra) | anthropic/claude-haiku-4-5 | pass | |
| S1 | same (extra) | openai/gpt-5.6-luna#low | pass | |
| S2 | tool call + tool-result turn | fast | pass | id `chatcmpl-tool-a444bdd1ebf63d27`, args `{"city":"Paris"}`; turn 2 "18°C and cloudy". SDK echoed the assistant message back with `content:null, refusal:null`; accepted |
| S2 | same | anthropic/claude-haiku-4-5 | pass | id `toolu_011V...` |
| S2 | same | openai/gpt-5.6-luna#low | pass | id `call_IZOZ...` |
| S3 | streaming text (+ include_usage) | fast | pass | both variants: first delta `role:assistant`, content `pong`, `finish_reason:stop`; with include_usage last chunk `choices: []` + usage; `for await` ends cleanly on `[DONE]` |
| S4 | streaming tool call | fast | pass | raw `for await`: 1 tool_call delta (index 0, id, type function, name, full args), assembled OK. `client.chat.completions.stream()` + `finalChatCompletion()` assembled the single-delta tool call correctly (`tool_calls[0]` id/name/arguments present, `tool_calls.function.arguments.done` event fired once, usage kept). `runTools` with a local `get_weather` function: tool executed client-side, 2nd request sent, final "18°C ... cloudy" |
| S5 | image data URL | fast | pass | "Red" (fast accepts images) |
| S5 | same | anthropic/claude-haiku-4-5 | pass | "Red." |
| S5 | same (extra) | openai/gpt-5.6-luna#low | pass | "Red" |
| S6 | structured output (raw `response_format.json_schema` from fixture, `.parse()` + `zodResponseFormat`, `.stream()` + `zodResponseFormat` + `finalChatCompletion`) | fast | pass | all three: numeric `calories`/`protein_g`, no extra keys; `.parse()` populated `message.parsed` |
| S6 | same | anthropic/claude-haiku-4-5 | pass | all three variants |
| S6 | same | openai/gpt-5.6-luna#low | pass | all three variants |
| S7 | list models | n/a | pass | `for await (const m of client.models.list())` iterated 387 models, 387 unique, 0 duplicates, `fast`, `anthropic/claude-*`, `*#low` present; `created: 0` and extra `plugboard` field tolerated |
| ERR | wrong key / unknown model | n/a | pass | see below |
| EXTRA | `developer` role + `max_completion_tokens` + `reasoning_effort:"low"` on fast | fast | pass | 200, `pong` |

## Failures (exact error text)

None.

Error path details (client surfaces the OpenAI error body correctly):

- wrong key, chat and `models.list()`: `AuthenticationError` (`instanceof OpenAI.AuthenticationError`), `status=401 code=invalid_api_key type=authentication_error`, message `401 Missing or invalid API key`.
- model `nope`: `NotFoundError`, `status=404 code=model_not_found type=not_found_error param=model`, message `404 Model nope is not available`. Same for `stream: true` (plugboard returns plain JSON 404 before SSE starts, which the SDK handles).

## Suspected plugboard bugs

None blocking. Minor observations (usage accounting, probably not client related; time 20:16 to 20:17Z):

1. **(Superseded: usage accounting was fixed in #10, re-check on the release commit.) `reasoning_tokens` inconsistent with `completion_tokens` / `total_tokens` on `fast`.** Same model, similar prompts:
   - non-stream S6 (request `{"model":"fast","messages":[{"role":"user","content":"Estimate: 2 boiled eggs and a slice of toast."}],"response_format":{...}}`), response usage: `{"prompt_tokens":200,"completion_tokens":19,"total_tokens":219,"completion_tokens_details":{"reasoning_tokens":38}}`. Here `reasoning_tokens` (38) exceeds `completion_tokens` (19) and is not in `total_tokens`; OpenAI semantics is that `completion_tokens` includes reasoning.
   - Same model, S6 `.parse()` response: `"completion_tokens":141,...,"reasoning_tokens":0` (reasoning folded into completion, reported as 0).
   - S1 non-stream fast `completion_tokens: 36`, S3 stream `completion_tokens: 102` for content `pong`, both `reasoning_tokens: 0`.
   So reasoning tokens are sometimes counted in `completion_tokens` with `reasoning_tokens: 0`, and sometimes reported separately and excluded from the total. Suspected cause: plugboard maps opencode's `tokens.output`/`tokens.reasoning` without checking whether the provider's `output` already includes reasoning. Likely a plugboard mapping issue (or provider-reported variance); does not break the client. Confidence low to medium.
2. Non-final stream chunks carry `"usage":null` even when `stream_options.include_usage` was not requested (S3 first variant). OpenAI omits the field then; the SDK ignores it. Cosmetic.
3. README says `/v1/models` lists 458 ids with about 71 duplicates; this run (during hot reload) got 387 ids, 0 duplicates (both through the SDK and a plain curl). Not a bug I can attribute; the catalogue apparently changed. The SDK iteration is fine either way.

Raw S4 stream exactly as plugboard sent it (single tool_call delta, `[DONE]` at end):

```
data: {"id":"chatcmpl-8dddc8023e1444498567eb73c7cb9","object":"chat.completion.chunk","created":1791749788,"model":"fast","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null,"logprobs":null}],"usage":null}

data: {"id":"chatcmpl-8dddc8023e1444498567eb73c7cb9","object":"chat.completion.chunk","created":1791749788,"model":"fast","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"25738ddc-b7e3-42fd-a547-ce67e5a7d558","type":"function","function":{"name":"get_weather","arguments":"{\"city\":\"Paris\"}"}}]},"finish_reason":null,"logprobs":null}],"usage":null}

data: {"id":"chatcmpl-8dddc8023e1444498567eb73c7cb9","object":"chat.completion.chunk","created":1791749788,"model":"fast","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls","logprobs":null}],"usage":null}

data: {"id":"chatcmpl-8dddc8023e1444498567eb73c7cb9","object":"chat.completion.chunk","created":1791749788,"model":"fast","choices":[],"usage":{"prompt_tokens":177,"completion_tokens":12,"total_tokens":189,"prompt_tokens_details":{"cached_tokens":0},"completion_tokens_details":{"reasoning_tokens":0}}}

data: [DONE]
```

Raw error bodies:

```
401: {"error":{"message":"Missing or invalid API key","type":"authentication_error","param":null,"code":"invalid_api_key"}}
404: {"error":{"message":"Model nope is not available","type":"not_found_error","param":"model","code":"model_not_found"}}
```

Note: tool-call ids from `fast` vary by run (`chatcmpl-tool-...` or a plain UUID); this is the upstream model/provider, the SDK does not care.

## What the client actually sends (notable fields)

- Plain: `{model, messages}` only. No `max_tokens`, no `temperature`, no default `developer` role; `User-Agent: OpenAI/JS 7.32.0`, `x-stainless-*` headers.
- `stream: true` adds nothing unless asked; `stream_options: {"include_usage": true}` only when set by the caller. The `.stream()` helper sets `stream: true` itself.
- Tool turn 2 (SDK echoing the returned assistant message): `{"role":"assistant","content":null,"refusal":null,"tool_calls":[{"id":...,"type":"function","function":{"name":...,"arguments":"..."}}]}` followed by `{"role":"tool","tool_call_id":...,"content":...}`. `refusal: null` is accepted.
- `zodResponseFormat` sends `response_format.json_schema` with `name`, `strict: true` and the schema including `"$schema":"http://json-schema.org/draft-07/schema#"` and `additionalProperties:false`; accepted by all three models.
- `runTools` sends the tool schema with the same shape as a normal `tools` array and, in the second request, assistant `tool_calls` + `tool` message without `refusal`.
- `developer` role, `max_completion_tokens` and `reasoning_effort: "low"` accepted on `fast` (200).
- Image: `content` parts `[{type:"text"},{type:"image_url",image_url:{url:"data:image/png;base64,..."}}]` (image content is large; omitted in the proxy log analysis above).

## Notes / follow-ups

- Total requests: about 45 including helper variants (S4 sends 3 stream/runTools exchanges, S6 3 per model).
- Sessions from this run were not deleted. At the time `compat/tools/sessions.py` could not attribute a session to a client (no session id in response headers or the traffic log), and other runs shared the `compat` app with identical prompts. The requests ran 20:16:14Z to 20:17:05Z (16:16:14 to 16:17:05 EDT). Superseded: responses now carry an `x-plugboard-session` header with the session id.
- `compat/js/package.json` untouched; no extra deps needed (`openai/helpers/zod` with zod 4.6.6 works).

Script: `compat/js/openai_js.ts`.
