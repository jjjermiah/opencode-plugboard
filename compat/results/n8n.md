# n8n against plugboard

- Date / tester: 2026-10-11, client agent (n8n)
- Client + exact version(s): n8n **2.42.6** (`docker.n8n.io/n8nio/n8n:latest`, digest `sha256:526daa38b68e…`). Nodes: `@n8n/n8n-nodes-langchain` bundled; OpenAI Chat Model v1.3 (uses `@langchainjs/openai`, `openai` JS SDK 6.46.0 per `X-Stainless-Package-Version`), Basic LLM Chain v1.9, AI Agent v3.1, Code Tool v1.3, Structured Output Parser v1.3
- Env: docker (colima, Docker 29.6.2). Container `plugboard-compat-n8n`, port 5678, via logproxy on `0.0.0.0:4093` → plugboard `:4010`. Credential Base URL `http://host.docker.internal:4093/v1` (needs `--add-host host.docker.internal:host-gateway`; `http://host.lima.internal:PORT` and `http://10.0.1.103:PORT` also reached the proxy from a throwaway curl container)
- Plugboard commit: `f351307`
- Verdict (README gate = S1 and S2 pass): **PASS**. S1 to S7 all pass. The only failures are n8n default/advanced options that plugboard correctly forwards and the upstream provider rejects (see S8 and the Responses API default).

How it was driven (all headless, no UI): `compat/docker/n8n/run.sh all` (`up`, `scenarios`, `down` also work alone). Owner via `POST /rest/owner/setup`, login via `POST /rest/login`, public API key via `POST /rest/api-keys` (valid scopes: `workflow:create|read|list|update|delete|activate|deactivate`, `credential:*`, `execution:*`; `workflow:execute` does not exist, so the key request fails with `{"code":..,"message":..}`), credential via public API `POST /api/v1/credentials` (`type: openAiApi`, `data.url` = Base URL), credential test via internal `POST /rest/credentials/test`, workflows via `POST /api/v1/workflows` + `/activate`, executed through production **webhook** URLs (`/webhook/<path>`). The public API has no "execute workflow" endpoint, so webhooks were the way. The model is set **By ID** with an expression: `{"__rl":true,"mode":"id","value":"={{ $('Webhook').first().json.body.model }}"}`, so one workflow serves all three models.

## Scenarios

| # | Scenario | Model | Result | Notes |
|---|---|---|---|---|
| S1 | plain chat, non-stream (Basic LLM Chain, Responses API off) | fast | **pass** | `{"text":"pong"}`; request only `{model, stream:false, messages}` |
| S2 | tool call + tool-result turn (AI Agent + Code tool `get_weather`) | fast | **pass** | turn 1 `finish_reason: tool_calls`, turn 2 `stop`, answer "18°C ... cloudy" |
| S2 | same | anthropic/claude-haiku-4-5 | **pass** | tool id `toolu_...` round-trips; answer mentions 18°C, cloudy |
| S2 | same | openai/gpt-5.6-luna#low | **pass** | tool id `call_...`; answer "Paris: 18°C and cloudy." |
| S3 | streaming text (+ include_usage) | fast | **pass** | AI Agent with streaming webhook (`responseMode: streaming`, `enableStreaming: true`) sends `stream:true` + `stream_options.include_usage:true`; n8n emitted `item: "pong"` |
| S4 | streaming tool call | fast | **pass** | tool-call delta (whole arguments in one delta) assembled by langchain; follow-up streamed turn answered "18°C and cloudy" |
| S5 | image data URL (Basic LLM Chain, message type Image URL) | fast | **pass** | answered `Red`; sent as `content: [{type:image_url,...},{type:text,...}]` |
| S5 | same | anthropic/claude-haiku-4-5 | **pass** | `Red.` |
| S6 | structured output (Structured Output Parser, prompt-injected schema) | fast | **pass** | n8n does **not** use `response_format` for this; schema goes in the user message, model returns a ```` ```json ```` fenced block. Parsed `{calories:230, protein_g:16}` |
| S6 | same | anthropic/claude-haiku-4-5 | **pass** | `{calories:280, protein_g:18}` |
| S6 | same | openai/gpt-5.6-luna#low | **pass** | `{calories:236, protein_g:15.6}` |
| S6b | `response_format: {"type":"json_object"}` (Chat Model option "Response Format: JSON") | fast | pass (model flaky) | HTTP 200 both runs. Run 1 content `{"calories":"230","protein_g":"16"}` (strings), final run content `{}` (model behaviour, see notes) |
| S6b | same | anthropic/claude-haiku-4-5 | **pass** | `{"calories":280,"protein_g":18}` |
| S6b | same | openai/gpt-5.6-luna#low | **pass** | `{"calories":236,"protein_g":15.6}` |
| S7 | list models (credential test + model dropdown `searchModels`) | n/a | **pass** | credential test "Connection successful!" (`GET /v1/models` 200, UA `n8n`); dropdown filter `fast` → `fast`, `claude-haiku` → 29 ids incl. `anthropic/claude-haiku-4-5`, `#low` → 61 ids; unfiltered 387 ids, all unique (n8n collapses the ~71 duplicate ids; no break on `created: 0` or the extra `plugboard` object) |
| err | wrong key | n/a | pass | credential test → `{"status":"Error","message":"Unauthorized"}` (plugboard 401 `invalid_api_key`) |
| err | model `nope` | fast-chain | pass | plugboard 404 `model_not_found`; n8n execution error: "The resource you are requesting could not be found" / description "Model nope is not available" |
| extra | Chat Model node left at its **default** (Use Responses API = on) | fast | **fail (expected)** | n8n calls `POST /v1/responses` → plugboard 404 (below) |
| S8 | sampling options in node Options (temperature, topP, maxTokens, frequencyPenalty, presencePenalty) | all three | **fail (400 from provider)** | upstream rejects some of the params; per-param matrix below |

## Failures (exact error text)

1. Default node settings (Responses API on):
   - Request: `POST /v1/responses` `{"input":[{"type":"message","role":"user","content":"Reply with exactly: pong"}],"model":"fast","stream":false,"text":{}}`
   - Response 404: `{"error":{"message":"No route for POST /v1/responses","type":"not_found_error","param":null,"code":"not_found"}}`
   - n8n shows "Error in workflow". The node setting is `Use Responses API` (`responsesApiEnabled`), **default `true` on Chat Model v1.3**, even with a custom Base URL, so a fresh n8n user pointing at plugboard hits this first. Fix on the n8n side: switch it off (all workflows here set `"responsesApiEnabled": false`).
2. S8 (sampling options). Per-param probe sent straight to plugboard (not via n8n) to separate which param does what (HTTP status):

   | param | fast | claude-haiku-4-5 | openai/gpt-5.6-luna#low |
   |---|---|---|---|
   | `temperature: 0.2` | 200 | 200 | 400 `Unsupported parameter: temperature` |
   | `top_p: 0.9` | 200 | 200 | 400 `Unsupported parameter: top_p` |
   | `max_tokens: 300` | 200 | 200 | 200 |
   | `frequency_penalty: 0.1` | 400 | 200 | 400 `Unsupported parameter: frequency_penalty` |
   | `presence_penalty: 0.1` | 400 `only presence_penalty=0 is supported` | 200 | 400 `Unsupported parameter: presence_penalty` |

   All together (what the n8n node sends when all five are set) on haiku: `{"error":{"message":"`temperature` and `top_p` cannot both be specified for this model. Please use only one.","type":"invalid_request_error","param":null,"code":"provider.invalid-request"}}` (HTTP 400). On fast: `Upstream request failed: [unsupported_value] only presence_penalty=0 is supported`. On luna: `Unsupported parameter: temperature`. n8n surfaces these as "Bad request - please check your parameters" with the text as description.

## Suspected plugboard bugs

None confirmed. Items for the orchestrator to judge (classification in brackets):

1. **`POST /v1/responses` is a 404** [feature gap, plugboard intentionally Chat Completions only; n8n default is Responses API on]. Raw above. Documentation item: tell n8n users to turn "Use Responses API" off. If plugboard ever adds `/v1/responses`, n8n would work without that toggle.
2. **Sampling params are forwarded; provider-specific rejections come back as HTTP 400 `provider.invalid-request`** [model/provider behaviour, plugboard passes it through faithfully]. Real OpenAI behaves the same for gpt-5 reasoning models (`Unsupported parameter: temperature`), so clients that always send `temperature` (n8n does only when the user sets it) break on `#low` ChatGPT ids. Consider (design choice, not a bug): silently dropping unsupported sampling params for models that reject them. Raw request (n8n, run at 16:2x EDT): `{"model":"openai/gpt-5.6-luna#low","temperature":0.2,"top_p":0.9,"frequency_penalty":0.1,"presence_penalty":0.1,"stream":false,"max_tokens":300,"messages":[{"role":"user","content":"Reply with exactly: pong"}]}` → 400 `{"error":{"message":"Unsupported parameter: temperature","type":"invalid_request_error","param":null,"code":"provider.invalid-request"}}`.
3. **`usage` on `fast`: `completion_tokens` high but `reasoning_tokens` 0 and tiny content** [unverified, low priority, possibly plugboard usage mapping or model]. Example (S6b, `fast`, json_object): content `{}` (2 chars) with `"usage":{"prompt_tokens":188,"completion_tokens":165,"total_tokens":353,"prompt_tokens_details":{"cached_tokens":0},"completion_tokens_details":{"reasoning_tokens":0}}`. The README says `fast` reasons a little, so the 165 tokens are probably hidden reasoning not reported under `reasoning_tokens`. Same pattern in S1 (`pong`, 3 tokens, fine) vs S6 fast (`completion_tokens:200` for ~30 chars).
4. Transient: plugboard `:4010` was unreachable for about 1 minute (~16:31 to 16:32 EDT, hot reload by the other agent). During that window n8n's credential test said `Service Unavailable` (logproxy 502 "Connection refused"). Not a bug; re-run was clean.

Raw S2 exchange for reference (fast, non-stream; first `run.sh` pass, from the logproxy):

```
POST /v1/chat/completions
{"model":"fast","stream":false,"tools":[{"type":"function","function":{"name":"get_weather","description":"Get the current weather for a city. Input: the city name.","parameters":{"type":"object","properties":{"input":{"type":"string"}},"additionalProperties":false,"$schema":"http://json-schema.org/draft-07/schema#"},"strict":false}}],"messages":[{"role":"user","content":"What is the weather in Paris? Use the tool."}]}
-> 200 {"id":"chatcmpl-6d35...","object":"chat.completion","model":"fast","choices":[{"index":0,"message":{"role":"assistant","content":null,"refusal":null,"tool_calls":[{"id":"20084bea-5db3-4b93-9695-7ec25f7757c5","type":"function","function":{"name":"get_weather","arguments":"{\"input\":\"Paris\"}"}}]},"logprobs":null,"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":188,"completion_tokens":37,"total_tokens":225,...}}

POST /v1/chat/completions   (turn 2)
... "messages":[{"role":"user","content":"What is the weather in Paris? Use the tool."},
 {"role":"assistant","content":[],"tool_calls":[{"id":"20084bea-...","type":"function","function":{"name":"get_weather","arguments":"{\"input\":\"Paris\"}"}}]},
 {"role":"tool","content":"[{\"response\":\"{\\\"temp_c\\\":18,\\\"sky\\\":\\\"cloudy\\\",\\\"city\\\":\\\"Paris\\\"}\"}]","tool_call_id":"20084bea-..."}]
-> 200 ... "content":"Here's the current weather in Paris: ... 18°C ... Cloudy ...","finish_reason":"stop"
```

Streaming (S4, fast) raw response, plugboard to n8n:

```
data: {"id":"chatcmpl-0a32...","object":"chat.completion.chunk","model":"fast","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null,"logprobs":null}],"usage":null}
data: {...,"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"chatcmpl-tool-88144f1d316c2ef1","type":"function","function":{"name":"get_weather","arguments":"{\"input\":\"Paris\"}"}}]},"finish_reason":null,"logprobs":null}],"usage":null}
data: {...,"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls","logprobs":null}],"usage":null}
data: {...,"choices":[],"usage":{"prompt_tokens":188,"completion_tokens":12,"total_tokens":200,...}}
data: [DONE]
```

n8n accumulated it into a tool call, ran the Code tool, and sent a second streamed request with the assistant `tool_calls` + `tool` message; that returned the final text.

## What the client actually sends (notable fields)

- Default request body is minimal: `{model, stream, messages}` (+ `tools`). **No** `max_tokens`, `max_completion_tokens`, `n`, `top_p`, `temperature`, penalties, `parallel_tool_calls`, `tool_choice`, `developer` role or `reasoning_effort` unless the user sets them in the node's Options. None of the defaults trigger a plugboard 400.
- Option fields map: Sampling Temperature → `temperature`, Top P → `top_p`, Max Tokens → `max_tokens` (not `max_completion_tokens`), Frequency/Presence Penalty → `*_penalty`, Response Format JSON → `response_format:{"type":"json_object"}`, Reasoning Effort (low/medium/high) → `reasoning_effort` (not tested). "Extra Body" JSON merged into the body (not tested). The node's JSON-Schema response format only exists in Responses API mode, so Chat Completions mode never sends `json_schema`.
- Streaming: `stream:true` + `stream_options:{"include_usage":true}` only when the agent streams (needs a streaming webhook response mode). Chain nodes and the non-streaming agent send `stream:false`.
- Tools: `{"type":"function","function":{name, description, parameters:{type:object,properties:{input:{type:string}},additionalProperties:false,$schema:"http://json-schema.org/draft-07/schema#"}, strict:false}}`. The Code tool's schema has a single `input` string, so `arguments` is `{"input":"Paris"}` (not `city`).
- Tool-result turn: assistant message carries `"content": []` (empty **array**) next to `tool_calls`; tool message content is a JSON string `[{"response":"..."}]`. Plugboard accepted both.
- Images: user `content` array with `image_url` first, then the `text` part (`{"text":"...","type":"text"}`, key order differs from OpenAI's usual).
- Headers: `User-Agent: langchainjs-openai/1.0.0 ((node/v26.7.0; linux; arm64))`, `X-Stainless-*` (openai JS 6.46.0), extra `openai-platform: org-...` (n8n default header, harmless). `GET /v1/models` (credential test and dropdown) uses UA `n8n` / no UA and sends `OpenAI-Organization: ` (empty).
- Credential has an "Allowed HTTP Request Domains" setting; I set `all` (default for custom base URLs worked too, since the model calls only needed the base URL host).

## Notes / follow-ups

- Structured output via the Structured Output Parser is prompt-based (S6 passes on all three models) and returns the parsed value under `output`; `response_format: json_object` is the only true response-format passthrough n8n offers in Completions mode. If a strict-schema (`json_schema`) check against plugboard is wanted, use another client; n8n only sends it in Responses API mode.
- `fast` returned `{}` for the json_object prompt once and string numbers (`"230"`) once: model behaviour with `response_format: json_object` (no schema enforcement), not plugboard.
- n8n dedups model ids (387 shown of 458 listed), so the known duplicate ids do not hurt it.
- Container `plugboard-compat-n8n`, its volume, and the logproxy on 4093 are stopped and removed; image `docker.n8n.io/n8nio/n8n:latest` kept. State dir (`$TMPDIR/plugboard-compat-n8n`: cookie jar, API key, credential id) removed. n8n runs generated about 35 `compat` app sessions; cleanup left to the orchestrator (`python3 compat/tools/sessions.py list`).
- Raw traffic (gitignored): `compat/traffic/n8n.jsonl` (final run), `n8n-explore.jsonl` and `n8n-run1.jsonl` (earlier passes).
- Not tested: n8n Chat Hub / "OpenAI" vendor node (Message a Model, which uses the Responses API), memory sub-nodes, parallel tool calls, `reasoning_effort`, Extra Body.

Scripts committed under: `compat/docker/n8n/` (`run.sh`, `s1-chain.json`, `s1-responses-default.json`, `s2-agent.json`, `s3s4-stream-agent.json`, `s5-image.json`, `s6-structured.json`, `s6b-jsonobject.json`, `s8-options.json`).
