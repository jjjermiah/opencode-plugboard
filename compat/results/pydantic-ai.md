# pydantic-ai against plugboard

- Date / tester: 2026-10-11 / subagent (pydantic-ai lane)
- Client + exact version(s): `pydantic-ai-slim[openai]` 2.55.0 (`OpenAIChatModel` + `OpenAIProvider`, Chat Completions API), `openai` 3.29.0, `pydantic` 2.14.1
- Env: compat/py (uv, Python 3.13)
- Plugboard commit: 3fcedc7
- Verdict (README gate = S1 and S2 pass): **PASS**. No plugboard bug found. One flaky model answer (see Notes).

All calls went through logproxy (`:4041`, `compat/traffic/pydantic-ai.jsonl`, gitignored). Script: `compat/py/pydantic_ai_check.py`.

## Scenarios

| # | Scenario | Model | Result | Notes |
|---|---|---|---|---|
| S1 | plain chat (`Agent.run`) | fast | pass | `pong`; usage in=17 out=76 total=93 parsed |
| S1 | same | anthropic/claude-haiku-4-5 | pass | `pong`, usage 29/5/34 |
| S1 | same | openai/gpt-5.6-luna#low | pass | `pong`, usage 11/5/16 |
| S2 | tool call + tool-result turn (`@agent.tool_plain get_weather`, agent loop) | fast | pass | tool ran once with `city='Paris'`; turn 2 answered "18°C and cloudy"; 2 requests |
| S2 | same | anthropic/claude-haiku-4-5 | pass | same, 2 requests |
| S2 | same | openai/gpt-5.6-luna#low | pass | same, 2 requests |
| S3 | streaming text (`run_stream` + `stream_text(delta=True)`; pydantic-ai always sends `stream_options.include_usage`) | fast | pass | deltas `['pong']`, usage parsed from the `choices: []` chunk. `run_stream_events` also fine (PartStart, FinalResult, PartEnd, AgentRunResult) |
| S4 | streaming tool call (`run_stream_events` and `run_stream` + tool) | fast | pass | `PartStartEvent` ToolCallPart `get_weather`, id `chatcmpl-tool-8590fdf82bdff07b`, args `{"city":"Paris"}`; `FunctionToolCallEvent` fired; final text correct |
| S5 | image: `BinaryContent` (sent as data URL) and `ImageUrl(url="data:...")` | fast | pass (see Notes) | `BinaryContent` Red both runs. `ImageUrl` data URL: first run FAIL ("I don't see an image..."), rerun pass. Request bodies were identical; model flakiness |
| S5 | same | anthropic/claude-haiku-4-5 | pass | both forms `Red` (2 runs) |
| S5 | same | openai/gpt-5.6-luna#low | pass | both forms `Red` (not required by README, extra) |
| S6 | structured output `output_type=Meal` (tool mode), `NativeOutput`, `PromptedOutput` | fast | pass | all three give a valid `Meal` (see Notes for string-number quirk in prompted mode) |
| S6 | same | anthropic/claude-haiku-4-5 | pass | all three |
| S6 | same | openai/gpt-5.6-luna#low | pass | all three |
| S7 | list models (`provider.client.models.list()`, openai SDK; pydantic-ai has no model-listing API) | n/a | pass (partial n.a.) | parsed 387 entries, `fast`, a claude id and `#low` ids present, 0 duplicate ids, `created: 0` and the extra `plugboard` object tolerated. pydantic-ai itself does not list models |
| X | wrong key | fast | pass | `ModelHTTPError: status_code: 401, model_name: fast, body: {'message': 'Missing or invalid API key', 'type': 'authentication_error', 'param': None, 'code': 'invalid_api_key'}` |
| X | model `nope` | nope | pass | `ModelHTTPError: status_code: 404, model_name: nope, body: {'message': 'Model nope is not available', 'type': 'not_found_error', 'param': 'model', 'code': 'model_not_found'}` |
| X | `system_prompt` + `openai_reasoning_effort="low"` + `max_tokens=400` | fast | pass | request: `system` role, `reasoning_effort: "low"`, `max_completion_tokens: 400`; 200, `pong` |

## Failures (exact error text)

No client-side validation error in any scenario. The only failing observation: S5 `ImageUrl(data:...)` on `fast`, first run, no exception, model answer `"I don't see an image in your message—only text came through. Could you try uploading it again?"`

## Suspected plugboard bugs

None.

The one oddity, S5 `fast` (model behaviour, not plugboard). Two identical requests (rows 28 and 29 in the log), run 2 s apart, produced different answers:

Request (identical both times, image truncated):
```json
{"model":"fast","stream":false,"messages":[{"role":"user","content":[{"text":"What color is this image? One word.","type":"text"},{"image_url":{"url":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgA..."},"type":"image_url"}]}]}
```
Response A (200): `"content":"Red"`, usage 39/104/143.
Response B (200): `"content":"I don't see an image in your message—only text came through. Could you try uploading it again?"`, usage 39/204/243.
The prompt token count (39) is identical in both and low enough that it probably does not include image tokens, so `fast` (glm-5.3-flash) may be text-only upstream and "Red" a lucky guess. Unverified. Worth a check whether plugboard strips/forwards image parts for models whose `plugboard.capabilities.image` is false. Sample entry from `/v1/models`: `{"id":"anthropic/claude-haiku-5-5","object":"model","created":0,"owned_by":"anthropic","plugboard":{"capabilities":{"tools":true,"image":true},"contextLimit":1000000}}`. I did not look up the capability flags for `fast`.

## What the client actually sends (notable fields)

- Non-stream requests carry explicit `"stream": false`. Stream requests add `stream_options: {"include_usage": true}`.
- Role for system prompts: `system` (not `developer`) for all three model names (pydantic-ai profile unknown for these ids). `Agent(system_prompt=...)` → `{"role":"system"}`.
- `openai_reasoning_effort="low"` → `reasoning_effort: "low"`; `max_tokens` → `max_completion_tokens`. Both accepted.
- Tools: `tool_choice: "auto"` (or `"required"` for tool-mode structured output), tool objects carry `"strict": true` and `additionalProperties:false`. Accepted by all three models.
- Tool-mode output: a tool named `final_result`; plugboard returned `finish_reason: tool_calls` with a UUID id, pydantic-ai parsed it.
- NativeOutput: `response_format: {"type":"json_schema","json_schema":{"name":"Meal","schema":{...},"strict":true}}`. PromptedOutput: schema in a `system` message plus `response_format: {"type":"json_object"}`. Both worked.
- Turn 2 of a tool loop: `user`, `assistant` (with `tool_calls`), `tool` messages. Accepted.
- Image: content parts `text` + `image_url {url: data:image/png;base64,...}` (no `detail`).
- pydantic-ai does not parse `usage.*_details` strictly; the extra `prompt_tokens_details.cached_tokens`, `completion_tokens_details.reasoning_tokens` and `choices[].message.refusal: null`, `logprobs: null` fields are all fine. Chunks have `usage: null` on non-final chunks, tolerated.
- Response fields id / created / model were present on all chat responses and chunks.

## Notes / follow-ups

- Streaming tool call arrives as one delta with the whole arguments string, `index: 0`, `id`, `type`, `name`. pydantic-ai assembles it correctly. Tool-call ids differ between non-stream (UUID) and stream (`chatcmpl-tool-...`); harmless.
- Streaming text: the entire `pong` arrives in a single content delta after an initial `role: assistant, content: ""` delta; pydantic-ai handled it.
- PromptedOutput on `fast`: the model returned numbers as strings (`{"calories":"235","protein_g":"14"}`). pydantic's lax mode coerced them, so this passed. With strict validation it would fail. Model behaviour, since `json_object` mode does not enforce the schema.
- `/v1/models` returned 387 ids, none duplicated, when I ran S7 (the README says 458 with ~71 duplicates; the dev server presumably changed since the README was written, or that count is stale). Not a client problem either way.
- Session cleanup: sessions carry no id in the proxy log, so I deleted my sessions by matching (second, model, prompt) against the proxy log: 48 deleted. Parallel agents using the same models and prompts at the same second could have been matched too (their sessions are throwaway). A few of my sessions (tool-turn titles) may remain; `sessions.py delete --older-than` will catch them.
- Not tested: parallel tool calls, `developer` role (pydantic-ai chose `system`; would need a profile with `openai_system_prompt_role='developer'`), reasoning-model profile (`openai_reasoning_*`) on `#high` variants, Responses API (`OpenAIResponsesModel`; plugboard may not implement `/v1/responses`).

Scripts committed under: `compat/py/pydantic_ai_check.py` (not committed per instructions)
