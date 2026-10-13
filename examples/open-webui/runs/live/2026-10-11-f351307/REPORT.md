# Open WebUI against plugboard

> Historical record of one run at `f351307`, before the later refactors. Superseded since: the usage accounting observation (fixed in [#10](https://github.com/jjjermiah/opencode-plugboard/issues/10)). Re-test on the release commit is tracked in [`release-candidate.md`](release-candidate.md).

- Date / tester: 2026-10-11, automated run
- Client + exact version(s): Open WebUI **0.12.0** (`ghcr.io/open-webui/open-webui:main`, image id `e597ba2ca442`; Python 3.11, aiohttp 3.14.3 does the upstream HTTP)
- Env: docker via colima (`docker info` OK). Container `plugboard-compat-owui`, host port 3091, `WEBUI_AUTH=False`, `ENABLE_OLLAMA_API=false`. Open WebUI pointed at a logproxy on `0.0.0.0:4091` (`compat/traffic/open-webui.jsonl`, 32 chat requests + 3 model-list fetches), which forwards to plugboard `:4010`.
- Plugboard commit: `f351307` when testing started (HEAD read `85e5027` at the end; no plugboard source change was visible to me mid-run, no transient failures seen)
- Verdict (README gate = S1 and S2 pass): **PASS**, driven over HTTP only. S6 was a direct API call because Open WebUI has no structured-output feature in its UI, and `fast` answered "Crimson" in S5.
- Driven over HTTP only (no browser): `POST /api/v1/auths/signin` for a token, `/api/models`, `/api/chat/completions`, plus `/api/v1/chats/new` to emulate the frontend so the server-side title/tags/follow-up tasks fire. Commands: `compat/docker/open-webui.sh`. Container reachability: the host name for the machine and `host.docker.internal:4010` (with `--add-host ...:host-gateway`) both returned `{"ok":true}` from a throwaway container.

## Scenarios

| # | Scenario | Model | Result | Notes |
|---|---|---|---|---|
| S1 | plain chat | fast | pass | `/api/chat/completions` non-stream: 200, `pong`, `finish_reason: stop`, usage 17/32/49. Plugboard saw Open WebUI's body unchanged (`{model, stream:false, messages}`). |
| S2 | tool call + tool-result turn | fast | pass | Native mode (Open WebUI runs the tool itself and loops). Turn 1 streamed `tool_calls` (id `chatcmpl-tool-8edb7ff7bd5bf14f`, `get_weather`, `{"city":"Paris"}`, `finish_reason: tool_calls`). Open WebUI then sent `user,assistant(tool_calls),tool` back; turn 2 `stop`, "18°C ... cloudy". Also passed with `function_calling: legacy` (prompt-based, see below). |
| S2 | same | anthropic/claude-haiku-4-5 | pass | native; tool_calls then stop, answer mentions 18 and cloudy |
| S2 | same | openai/gpt-5.6-luna#low | pass | native; tool_calls then stop, "18°C and cloudy" |
| S3 | streaming text (+ include_usage) | fast | pass | Open WebUI always streams in the UI path and sends `stream_options.include_usage:true`. Chunks: role chunk, `pong`, `finish_reason: stop`, `choices:[]` + usage chunk, `[DONE]`. Without `stream_options` (direct API) no usage chunk, still fine. |
| S4 | streaming tool call | fast | pass | Open WebUI's own tool loop reads the streamed `delta.tool_calls` (whole arguments in one delta) and assembles them: stored as `function_call` output item with `arguments: "{\"city\":\"Paris\"}"`, executed, result fed back. Same on haiku and luna. |
| S5 | image data URL | fast | pass | `image_url` data URL forwarded verbatim; `fast` accepted it and answered `Crimson` (not "red": model behaviour, not a bug) |
| S5 | same | anthropic/claude-haiku-4-5 | pass | `Red` |
| S6 | structured output | fast | pass* | *Open WebUI has no structured-output feature in its UI. The API forwards `response_format` unchanged; `{"calories":220,"protein_g":15}` |
| S6 | same | anthropic/claude-haiku-4-5 | pass* | `{"calories":200,"protein_g":14}` |
| S6 | same | openai/gpt-5.6-luna#low | pass* | `{"calories":236,"protein_g":16}` |
| S7 | list models | n/a | pass | 3 fetches of `GET /v1/models`, all 200. Open WebUI shows **387** models (plugboard returned 387 ids, 0 duplicates at test time, so no dedupe loss; the README's 458/71 dups no longer applies). `fast`, `anthropic/claude-haiku-4-5`, `openai/gpt-5.6-luna#low` all present. `/api/models` is 197 KB and answers in 47 ms (cached). The extra `plugboard` object is tolerated (and passed through under each entry). `created: 0` is fine. |
| Err | wrong key | n/a | pass | `POST /openai/verify` with a bad key returns plugboard's body verbatim: `{"error":{"message":"Missing or invalid API key","type":"authentication_error","param":null,"code":"invalid_api_key"}}` (plugboard 401 seen in the proxy log). |
| Err | model `nope` | n/a | n.a. | Open WebUI validates against its own list: `HTTP 400 {"detail":"Model not found"}`, request never reaches plugboard. |

## Function Calling modes (Open WebUI 0.12.0 differs from older docs)

In 0.12.0 there is no "default" mode any more. The code checks only `params.function_calling == 'legacy'` (`open_webui/utils/middleware.py`):

- anything else (including the string `default`, and the unset case) = **native**: real OpenAI `tools` in the request, Open WebUI runs the tool server side and re-sends `user, assistant{tool_calls}, tool`. This is the path plugboard serves. Works.
- `legacy` = prompt-injected. Open WebUI first makes a **non-stream** call with a system prompt `Available Tools: [...] ... return only JSON {"tool_calls":[...]}`, no `tools` in the request, then runs the tool and makes the final streamed call with the result as context text. Also works on `fast` (reply was `{"tool_calls":[{"name":"get_weather","parameters":{"city":"Paris"}}]}`, final answer "The weather in Paris is 18°C and cloudy [1].").

## Auxiliary calls (UI chat path, background_tasks title/tags/follow-ups)

Per chat turn with all three enabled (the frontend default), Open WebUI fires **3 extra non-stream calls** after the answer, to the same model (no task model set), in this order: follow-ups, title, tags. All three returned 200 and Open WebUI parsed them every time (title and tags were written to the chat; 5 follow-ups stored).

| Aux call | Request keys | Notes |
|---|---|---|
| follow-ups | `{model, messages:[user "### Task: Suggest 3-5 relevant follow-up questions..."], stream:false}` | reply text is JSON: `{ "follow_ups": [ ... ] }` |
| title | `{model, messages, max_tokens, stream:false}` | `{ "title": "Paris Weather Query" }` |
| tags | `{model, messages, stream:false}` | `{ "tags": ["General"] }` |

No `response_format`, no `tools`, no `developer` role, no `reasoning_effort` in any of them. They are plain text prompts that ask the model for JSON. No aux call failed on any of the 4 chat runs on `fast` that had aux tasks enabled. Aux calls are skipped when the request has no `chat_id` (direct API use).

## What the client actually sends (notable fields)

- Main UI request: `{messages, model, stream:true, stream_options:{include_usage:true}, tools:[...]}`. Nothing else: no `max_tokens`, `temperature`, `tool_choice`, `parallel_tool_calls`, `user`.
- Native mode default injects **31 built-in tools** (`get_current_timestamp`, `search_chats`, `view_note`, `create_automation`, `search_calendar_events`, ...) into every UI chat request, even with no tool selected: a plain "pong" chat has `tools` length 31 and `prompt_tokens` 5574 (vs 17 on the bare API). With the user tool it is 32. Plugboard handled these tool schemas on all three models with no error, but note the cost and that these are real `tools`, so plugboard's tool bridge is exercised on every normal Open WebUI chat.
- Messages are plain `{role, content}`; assistant tool-call turn has `content: ""` plus `tool_calls`; tool result is `{role:"tool", tool_call_id, content:"<string>"}`. Tool parameter schemas are `{properties, required, type:"object"}` with no `additionalProperties`.
- Direct-API params (`temperature`, `top_p`, `max_tokens`, `seed`, `stop`, `reasoning_effort`, `frequency_penalty`, system message) are forwarded untouched; plugboard returned 200 `pong` (checked once on `fast`, raw request in the traffic log).
- Model fetch headers: only `Authorization`, `Accept: */*`, `Accept-Encoding: gzip, deflate, br`, `User-Agent: Python/3.11 aiohttp/3.14.3`. Plugboard served the gzip-capable request fine.
- Open WebUI rewrites some response fields for its own clients (`owned_by` becomes `openai` at the top level, original kept under `openai`), not a plugboard concern.

## Failures (exact error text)

None on the scenarios. The only non-200 results were the two expected error-path checks above.

## Suspected plugboard bugs

None blocking. Minor observations (low confidence, plugboard behaviour):

1. (Superseded: fixed in #10.) `reasoning_tokens` inconsistent with `completion_tokens` on `fast`. Same prompt `Reply with exactly: pong`:
   - non-stream: `"usage":{"prompt_tokens":17,"completion_tokens":32,"total_tokens":49,"prompt_tokens_details":{"cached_tokens":0},"completion_tokens_details":{"reasoning_tokens":0}}`
   - stream (last chunk): `{"choices":[],"usage":{"prompt_tokens":17,"completion_tokens":3,"total_tokens":20,"prompt_tokens_details":{"cached_tokens":0},"completion_tokens_details":{"reasoning_tokens":101}}}` (reasoning excluded from `completion_tokens` here, included in the non-stream one).
   Open WebUI only displays these; no functional impact.
2. `prompt_tokens_details.cached_tokens` goes above `prompt_tokens` in one call: `"prompt_tokens":1195,...,"cached_tokens":4480` (final turn of the legacy/default run). Open WebUI summed it without error.
3. Streamed chunks carry `"usage":null` on every non-final chunk when the client sends `stream_options.include_usage` (this is the OpenAI shape and Open WebUI is fine with it) but also the role chunk has `"content":""`; fine, noted only.

## Notes / follow-ups

- Mutations in this run are local to the throwaway container: tool `weather`, chats, admin user. Container and volume removed, image `ghcr.io/open-webui/open-webui:main` kept. logproxy stopped. Sessions from this run (about 35 requests) remain in the plugboard `compat` app.
- Not covered: browser rendering (no browser), Open WebUI file upload path for images (used the direct image_url data URL), RAG/web search, multiple connections, `function_calling` set per model in Workspace (the same flag via request params).
- Open WebUI shows model ids as returned (including `#low`, `/` names); selecting by id works via API. Dropdown behaviour with 387 entries in the browser was not observed; the API list loads instantly (cached). `/v1/models` was fetched 3 times in this run (startup, my `/api/models` call, the verify button).
- Scripts: no files under `compat/py` or `compat/js`; helper is embedded in `compat/docker/open-webui.sh`.
