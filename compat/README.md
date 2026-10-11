# Plugboard client-compat kit

Shared setup for checking one OpenAI client at a time against a live plugboard (release gate D5). Each client agent
tests **one** client, runs scenarios S1 to S7, writes `compat/results/<client>.md`. Nothing to install or discover.

## Endpoint and auth

| | |
|---|---|
| Base URL (this Mac) | `http://127.0.0.1:4010/v1` |
| Base URL (Docker container) | `http://host.docker.internal:4010/v1` (add `--add-host host.docker.internal:host-gateway`), or `http://10.0.1.103:4010/v1` |
| Health | `GET http://127.0.0.1:4010/healthz` returns `{"ok":true}` |
| Key | file `~/.cache/opencode-adapter-dev/.compat-key` (mode 600). Header `Authorization: Bearer <key>`. App name `compat` |
| Env vars the kit scripts read | `PLUGBOARD_BASE_URL`, `PLUGBOARD_KEY` (both optional; defaults above) |

Load the key without printing it: `export PLUGBOARD_KEY=$(cat ~/.cache/opencode-adapter-dev/.compat-key)`.
Do **not** paste the key into result files. The dev OpenCode server is an isolated instance (`~/.cache/opencode-adapter-dev/oc`), not the user's real OpenCode.

## Models (all verified allowed and answering on 2026-10-11)

| Use | Model id | Notes |
|---|---|---|
| Default for every scenario | `fast` | alias for `opencode-go/glm-5.3-flash`; fast, cheap, reasons a little (reasoning tokens in usage) |
| Claude spot check | `anthropic/claude-haiku-4-5` | run S2, S5, S6 on it |
| ChatGPT spot check | `openai/gpt-5.6-luna#low` | ChatGPT models need a variant; `#` is part of the id. Run S2, S6 on it |

`GET /v1/models` lists 458 ids (every variant is its own entry, e.g. `anthropic/claude-haiku-4-5#high`). Each entry
carries an extra `plugboard` object (`capabilities`, `contextLimit`); strict clients must tolerate it.
Known oddity already seen: about 71 ids appear twice in the list (e.g. `openai/gpt-5.6-luna`). Report if your client breaks on duplicates or on `created: 0`.

## Fixtures (`compat/fixtures/`)

| File | Content |
|---|---|
| `red32.dataurl.txt` | `data:image/png;base64,...` of a solid red 32x32 PNG (`red32.png` is the raw file) |
| `get_weather.tool.json` | OpenAI tool object: `get_weather(city: string)`, `city` required |
| `get_weather.result.json` | tool result to feed back: `{"temp_c":18,"sky":"cloudy"}` |
| `meal_estimate.json_schema.json` | `{name, strict, schema}` for `response_format.json_schema`: object `calories` (number), `protein_g` (number), both required, `additionalProperties:false` |

Prompts to use (keep these exact so results are comparable):

- S1: `Reply with exactly: pong`
- S2/S4: `What is the weather in Paris? Use the tool.`
- S5: `What color is this image? One word.` with the red PNG
- S6: `Estimate: 2 boiled eggs and a slice of toast.`

## Scenarios (every client)

Mark each pass / fail / n.a. (n.a. = the client has no such feature; say so). Run on `fast` unless the row says otherwise.

| # | Scenario | Expected observable outcome |
|---|---|---|
| S1 | Plain chat, non-stream, `Reply with exactly: pong` | HTTP 200; assistant content contains `pong`; `finish_reason` `stop`; `usage` has prompt/completion/total tokens |
| S2 | Non-stream tool call, then follow-up turn. Send `get_weather` tool + the weather prompt. Then send the full history: assistant message with the returned `tool_calls`, a `tool` message (`tool_call_id` = returned id, content = `get_weather.result.json`), same `tools` | Turn 1: `finish_reason` `tool_calls`; one tool call named `get_weather`, `arguments` is a JSON string with `city` ≈ Paris; non-empty `id`; plugboard does not execute anything. Turn 2: HTTP 200, `finish_reason` `stop`, content mentions 18 and/or cloudy |
| S3 | Streaming text (`stream: true`), prompt of S1. Also with `stream_options.include_usage: true` | SSE chunks `chat.completion.chunk`; first delta has `role: assistant`; content deltas concatenate to `pong`; a `finish_reason: stop` chunk; with include_usage a last chunk with `choices: []` and `usage`; ends with `data: [DONE]` |
| S4 | Streaming tool call, S2 turn 1 with `stream: true` + include_usage | `delta.tool_calls[0]` has `index`, `id`, `type: function`, `function.name: get_weather`, arguments (plugboard currently sends the whole arguments string in one delta; clients must accumulate either way); a `finish_reason: tool_calls` chunk; usage chunk; `[DONE]`. The client's own tool-call objects must come out assembled |
| S5 | Image: user content parts `text` + `image_url` with the red data URL | 200; answer says red. Run on `fast` (see if the model accepts images; if the provider rejects it note the error) and on `anthropic/claude-haiku-4-5` (must say red) |
| S6 | Structured output: `response_format` json_schema (or the client's structured-output feature) with the meal schema | `message.content` parses as JSON with numeric `calories` and `protein_g` and no extra keys. Run on `fast`, `anthropic/claude-haiku-4-5`, `openai/gpt-5.6-luna#low` |
| S7 | List models (`GET /v1/models` through the client) | HTTP 200; client parses it; `fast` present; a Claude and a `#low` id present |

Optional if time allows: an error path (wrong key gives 401 `invalid_api_key`; model `nope` gives 404 `model_not_found`; check the client surfaces the OpenAI error body), and a `developer` role message or `reasoning_effort` if the client sends them by default.

Keep calls tiny: one prompt per scenario, no loops, no retries beyond what the client does itself. Whole client run is roughly 15 to 25 requests.

## Result report: `compat/results/<client>.md`

Copy `compat/results/_template.md`. Required: client + exact version(s), which env (`compat/py`, `compat/js`, docker), scenario table with pass/fail/n.a., exact error text for each fail, what request the client actually sent, and for every suspected plugboard bug the raw request and raw response (from the proxy log). Distinguish plugboard bug / client quirk / model behaviour; say which you think and why.

## Capturing raw traffic

`compat/tools/logproxy.py`: stdlib reverse proxy, streams SSE through, logs each exchange as JSONL with Authorization redacted.

```sh
python3 compat/tools/logproxy.py --port 4011 --out compat/traffic/<client>.jsonl &   # use a different port per agent if running in parallel
# point the client at http://127.0.0.1:4011/v1 with the same key
jq -c '{path,status,req_json,resp_body}' compat/traffic/<client>.jsonl
kill %1
```

`compat/traffic/` is gitignored; paste the relevant exchanges into your result file. Pick your own proxy port (4011 to 4099) so parallel agents don't collide.
Client debug flags also work: OpenAI Python `OPENAI_LOG=debug`; OpenAI JS `OPENAI_LOG=debug`; LangChain `set_debug(True)`; Vercel AI SDK `result.request.body` / `result.response.body`.

## Environments (preinstalled)

| Env | Run | Installed |
|---|---|---|
| `compat/py` (uv, Python 3.13) | `cd compat/py && uv run smoke.py` or `uv run python your_script.py` | `openai` 3.29.0, `langchain-openai` 1.7.0, `langchain-core` 1.6.9, `pydantic-ai-slim[openai]` 2.55.0, `pydantic` 2.14.1, `httpx` 0.28.1 (pinned in `uv.lock`) |
| `compat/js` (bun 1.4.2, Node 26.9) | `cd compat/js && bun smoke.ts` or `bun your_script.ts` | `openai` 7.32.0, `ai` 7.0.137, `@ai-sdk/openai` 4.0.91, `@ai-sdk/openai-compatible` 3.0.67, `@langchain/openai` 1.6.2, `@langchain/core` 1.2.17, `zod` 4.6.6 (pinned in `bun.lock`) |
| Docker (Open WebUI, n8n) | see `compat/docker/README.md` | Docker is installed but its VM is not usable right now; read that file |

Add your client's scripts under `compat/py/<client>/` or `compat/js/<client>/` and commit them with the result file. Need another package? `uv add <pkg>` / `bun add <pkg>` in that env is fine; note the version in your report. If you add a dependency, only commit `pyproject.toml`/`uv.lock` or `package.json`/`bun.lock` changes for your own client (other agents are working in the same tree, so `git add` only your own paths).

## Cleanup

Every request leaves a history session under `<dataRoot>/compat` (dataRoot = `~/.cache/opencode-adapter-dev/home/.local/share/opencode-plugboard`). From the repo root:

```sh
python3 compat/tools/sessions.py list                     # compat sessions only
python3 compat/tools/sessions.py delete --older-than 120  # or: --all, or specific ids
```

It wraps `~/.cache/opencode-adapter-dev/oc api session.list|session.remove` and refuses to delete anything whose `metadata.plugboard.app` is not `compat`. Raw equivalent: `~/.cache/opencode-adapter-dev/oc api get "/api/session?directory=<dataRoot>/compat&limit=100"` and `oc api session.remove --param sessionID=<id>`. Run `--all` once when your own client run is done (parallel agents share the `compat` app, so prefer `--older-than` while others are running, or delete by the ids you saw in your proxy log).

## Rules

- Dev server only (`:4010` here). Never run plain `opencode`; never touch `~/.config/opencode`, real projects, or the `sparkyfitness`, `default`, `kamogawa` apps' sessions.
- Do not restart the dev OpenCode service. Do not edit its config (`~/.cache/opencode-adapter-dev/home/.config/opencode/opencode.jsonc`); the `compat` key is already there. If something needs a config change, report it.
- Do not edit plugboard source (`src/`, `index.ts`). Another agent is changing it and the plugin hot-reloads: a transient 5xx / connection refused / odd behaviour may be a reload. Retry once after 10 s before calling it a bug. Record the time of the failure.
- Keep model calls tiny (one short prompt per scenario). Use `fast` by default.
- Don't print or commit the key. `compat/traffic/` and `node_modules`/`.venv` are gitignored.
