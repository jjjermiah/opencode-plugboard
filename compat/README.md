# Client compatibility kit

Scripts, fixtures and dated results for checking one OpenAI client at a time against a running plugboard. The results in `results/` are what the [client pages](../docs/clients/) are built from. Run it against an isolated server, not your everyday OpenCode: see [docs/development.md](../docs/development.md).

## Setup

| Env var | Default | Meaning |
| --- | --- | --- |
| `PLUGBOARD_BASE_URL` | `http://127.0.0.1:4010/v1` | Plugboard endpoint |
| `PLUGBOARD_KEY` | none, required | A key from the plugboard `keys` option. The scripts use the app name `compat` in the examples |
| `PLUGBOARD_OC` | `opencode` | CLI command for `tools/sessions.py` |
| `PLUGBOARD_DATA_ROOT` | `$XDG_DATA_HOME/opencode-plugboard` | History root, for `tools/sessions.py` |

Load the key without printing it, and keep it out of result files. `GET /healthz` returns `{"ok":true}` when the listener is up.

The scripts assume these ids are on the `models` allowlist:

| Use | Model id |
| --- | --- |
| Default for every scenario | `fast`, an alias for a cheap model of your choice |
| Claude spot check | `anthropic/claude-haiku-4-5` |
| ChatGPT spot check | `openai/gpt-5.6-luna#low` (ChatGPT models need a variant; `#` is part of the id) |

Change the constants at the top of each script if your allowlist differs.

## Fixtures

| File | Content |
| --- | --- |
| `fixtures/red32.dataurl.txt` | `data:image/png;base64,...` of a solid red 32x32 PNG (`red32.png` is the raw file) |
| `fixtures/get_weather.tool.json` | OpenAI tool object `get_weather(city: string)` |
| `fixtures/get_weather.result.json` | Tool result to feed back: `{"temp_c":18,"sky":"cloudy"}` |
| `fixtures/meal_estimate.json_schema.json` | `response_format.json_schema` for `{calories, protein_g}` |

Prompts, so results compare: S1 `Reply with exactly: pong`; S2/S4 `What is the weather in Paris? Use the tool.`; S5 `What color is this image? One word.` with the red PNG; S6 `Estimate: 2 boiled eggs and a slice of toast.`

## Scenarios

Mark each pass, fail or n.a. (the client has no such feature). Use `fast` unless noted.

| # | Scenario | Expected |
| --- | --- | --- |
| S1 | Plain chat, non-stream | 200, content contains `pong`, `finish_reason` `stop`, usage present |
| S2 | Tool call, then a follow-up turn with the assistant `tool_calls` and a `tool` message | Turn 1 `finish_reason` `tool_calls`, one `get_weather` call with a JSON string `arguments` and non-empty `id`. Turn 2 `stop`, mentions 18 or cloudy. Also on the Claude and ChatGPT ids |
| S3 | Streaming text, with and without `stream_options.include_usage` | Chunks, first delta has `role`, a `stop` chunk, a last chunk with `choices: []` and usage when requested, `[DONE]` |
| S4 | Streaming tool call | `delta.tool_calls[0]` has `index`, `id`, `type`, name and arguments. Plugboard sends the whole arguments in one delta; clients must accumulate either way |
| S5 | Image as `image_url` data URL | 200, answer says red. On `fast` and the Claude id |
| S6 | Structured output with `json_schema` (or the client's feature) | Content parses as JSON with numeric `calories` and `protein_g`, no extra keys. On all three ids |
| S7 | `GET /v1/models` through the client | 200, parses, `fast` and a `#low` id present. Each entry carries an extra `plugboard` object, so strict clients must tolerate it |

Optional: wrong key gives 401 `invalid_api_key`, model `nope` gives 404 `model_not_found`, and the client surfaces the OpenAI error body.

Keep calls tiny: one prompt per scenario, no loops. A whole client run is about 15 to 25 requests.

## Running

| Env | Run | Pinned in |
| --- | --- | --- |
| `py/` (uv, Python 3.12+) | `cd compat/py && uv run smoke.py`, or `uv run python openai_py.py` | `uv.lock` |
| `js/` (bun) | `cd compat/js && bun smoke.ts`, or `bun openai_js.ts`; type check with `bun run typecheck` | `bun.lock` |
| Docker (Open WebUI, n8n) | see [docker/README.md](docker/README.md) | image tags in the scripts |

`smoke.py` and `smoke.ts` run S1 and fail unless the reply contains `pong`. The larger scripts take scenario names (for example `S1,S2`).

## Results

Copy `results/_template.md` to `results/<client>.md`. Record the client and exact versions, the plugboard commit, a scenario table, exact error text for each failure, and for every suspected plugboard bug the raw request and response. Say whether you think it is a plugboard bug, a client quirk or model behaviour, and why. Results are dated evidence, so leave old ones as they are and add a new dated file when you re-test.

## Capturing traffic

`tools/logproxy.py` is a stdlib reverse proxy. It streams SSE through and writes each exchange as one JSONL object.

```sh
python3 compat/tools/logproxy.py --port 4011 --upstream http://127.0.0.1:4010 --out compat/traffic/<client>.jsonl &
# point the client at http://127.0.0.1:4011/v1 with the same key
jq -c '{path,status,req_json,resp_body}' compat/traffic/<client>.jsonl
```

- Captures are sensitive. Only the `Authorization` header is redacted; prompts, responses, tool arguments and other headers are logged as sent. The file is created with mode 600 and `compat/traffic/` is gitignored. Quote synthetic excerpts in results, not raw captures.
- The upstream must be `http://`. The proxy refuses `https://` rather than send it in clear text.
- Client debug flags also work: `OPENAI_LOG=debug` (OpenAI Python and JS), `set_debug(True)` (LangChain), `result.request.body` (Vercel AI SDK).

## Cleanup

Every request leaves a history session under `<data root>/compat`.

```sh
python3 compat/tools/sessions.py list
python3 compat/tools/sessions.py delete --all --dry-run
python3 compat/tools/sessions.py delete --older-than 120
```

The tool deletes only sessions whose `metadata.plugboard.app` matches `--app` (default `compat`). It never touches other apps. Runs that share the `compat` app share its history, so use `--older-than` or explicit ids while another run is active.
