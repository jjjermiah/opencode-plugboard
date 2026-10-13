# Examples harness

Every client example in `examples/<client>/` checks itself against plugboard and commits what it saw. This directory holds the shared part: the scenarios, the scripted model and server, the capture proxy, the orchestrator and the writer. Tracked in [#174](https://github.com/jjjermiah/opencode-plugboard/issues/174).

## Targets

| Target | Upstream | Use |
| --- | --- | --- |
| `scripted` | `scripted-server.ts`, plugboard over loopback with `scripted-model.ts` | CI and determinism. Output is byte-identical between runs |
| `live` | an isolated OpenCode server with real providers ([docs/development.md](../../docs/development.md)) | Real model behaviour. Never your everyday OpenCode |

The scripted model answers only the exact prompts in `_shared/scenarios.json`. Anything else gets an error, so a scenario cannot pass by accident.

## Scenarios

`_shared/scenarios.json` is the single list. Each scenario has an id, its exact prompt, the models it runs on, whether it is `required`, the routes that count as its own traffic, and the checks applied to the observations a runner reports.

| Id | Scenario | Required |
| --- | --- | --- |
| S1 | plain chat, non-stream | yes |
| S2 | tool call, then a tool-result turn | yes |
| S3 | streaming text, with and without usage | yes |
| S4 | streaming tool call | yes |
| S5 | image as data URL (answer says red) | yes |
| S6 | structured output (as text and as a forced tool) | yes |
| S7 | list models | yes |
| E1 | wrong key (401 `invalid_api_key`) | no |
| E2 | unknown model (404 `model_not_found`) | no |

Model ids: `fast`, `anthropic/claude-haiku-4-5` and `openai/gpt-5.6-luna#low`. In a directory name `/` and `#` become `-`.

## Scripted server by hand

```sh
bun examples/_harness/scripted-server.ts --port 4790
```

It prints `PLUGBOARD_BASE_URL` (ending in `/v1`) and `PLUGBOARD_KEY`, then stays up until it is killed or its stdin closes. With the key from that output:

```sh
curl -s http://127.0.0.1:4790/v1/chat/completions -H "Authorization: Bearer sk-plug-scripted-examples" \
  -H 'Content-Type: application/json' -d '{"model":"fast","messages":[{"role":"user","content":"Reply with exactly: pong"}]}'
```

## Summary schema

`run.schema.json` is the source of truth for `summary.json`. `golden/summary.json` is a hand-written example that the unit test in `test/unit/examples-harness.test.ts` validates.

## Commands

```sh
bun examples/_harness/run.ts <example>|all --target scripted|live [--docker]
```

- `scripted` starts `scripted-server.ts` in the same process. Output is byte-identical between runs; CI fails on a diff.
- `live` attaches to `PLUGBOARD_BASE_URL` (default `http://127.0.0.1:4010/v1`) with `PLUGBOARD_KEY`. Only on the isolated server from [docs/development.md](../../docs/development.md), never your everyday OpenCode. It writes `runs/live/<date>-<shortsha>/`, a new directory every time, and never rewrites one. `PLUGBOARD_COMMIT` overrides the commit name; otherwise the commit is the HEAD of `PLUGBOARD_CHECKOUT`. The recorded `plugboard.version` is the server's `packageVersion` from `GET /plugboard/status` when `PLUGBOARD_KEY` can read that route (#347). Otherwise it is that commit's `package.json` version (`git show <commit>:package.json`), not the checkout's working tree (#335). `opencode` is the server's `opencodeVersion` when it reports one, else `null` with a note in `summary.md`. A server that predates these fields falls back to git for the version. The commit always comes from the checkout (`PLUGBOARD_COMMIT` or its HEAD), so when the live server runs another build, the recorded version is the server's and the commit is not necessarily the one it runs. A commit the checkout does not have stops the run before the runner starts.
- `all` runs every example with a runner, skipping `smoke-*` (the harness's own self-tests, run by name) and Docker examples (a compose file in the directory) unless `--docker` is given.
- Every run passes the runner `PLUGBOARD_TARGET` (`scripted` or `live`). A gap can differ by target, so a runner may name gaps only for one target, as the n8n runner does for S6.
- `--docker` is for runners that start containers (Open WebUI, n8n). The capture proxy then listens on `0.0.0.0` for the length of the run, and the runner gets `PLUGBOARD_CONTAINER_URL` (`http://host.docker.internal:<port>`), the address a container uses to reach it. The proxy forwards the caller's key and never holds one, but run it only on a machine you trust.

The run exits 1 when a required scenario fails. A verdict is `fail` on a required failure, `partial` on a gap or an optional failure, `pass` otherwise.

## How a run works

1. `run.ts` starts the target and a capture proxy (`capture.ts`) on an ephemeral port.
2. It starts the example's runner (`uv run --frozen run.py` with a `pyproject.toml`, `bun run.ts`, or `bash run.sh`) with `PLUGBOARD_BASE_URL` (the proxy, ending in `/v1`), `PLUGBOARD_KEY` and `PLUGBOARD_CAPTURE_URL`.
3. The runner's helpers (`py/harness.py`, `ts/harness.ts`) mark each scenario with `POST $PLUGBOARD_CAPTURE_URL/__mark`, call the scenario function, apply the checks in `_shared/scenarios.json`, and print one JSON line per result. They print nothing else on stdout and write no files.
4. `run.ts` slices the exchanges by mark, normalises them (`normalise.ts`), validates `summary.json` against `run.schema.json`, refuses to write any file that contains the app key, renders `summary.md` and writes (`render.ts`).

Requests outside a scenario's routes (a UI refreshing `/v1/models`) go to `transcripts/_background.json`. That file is written but not compared in CI.

## Redaction

- Request headers: only `accept`, `anthropic-version`, `content-type` and `openai-beta`. Response headers: `content-type` and `x-plugboard-*` except `x-plugboard-request-id`. `authorization`, `x-api-key`, `x-goog-api-key`, `date`, `host`, `user-agent`, `x-stainless-*` and `content-length` are never written.
- A `key` query parameter (Gemini) is removed from the path.
- Ids are replaced by placeholders numbered by first appearance in each file, so one id keeps one placeholder across turns. A GET of a models route keeps its model ids.
- `http://127.0.0.1:<port>` becomes `<plugboard>`, error text included.
- The writer refuses any file that contains the app key. Live runs use only the prompts in `scenarios.json`.

## Adding an example

1. Create `examples/<client>/` with its own dependencies pinned (`pyproject.toml` + `uv.lock`, or `package.json` + `bun.lock`).
2. Write one scenario file per scenario the client supports, `run(client, model)` returning the observations the checks name (see `scenarios.json` for the names). Put the copyable part between `# region snippet-<name>` / `# endregion snippet-<name>` (Python, shell) or `// #region snippet-<name>` / `// #endregion snippet-<name>` (TypeScript); see Snippet regions below. Give the file a `__main__` / `import.meta.main` block so it runs alone.
3. Write the runner: `run.py` (import `harness` from `examples/_harness/py`), `run.ts` (import from `examples/_harness/ts/harness.ts`), or `run.sh`. Call `emit_client` / `emitClient` once, then `run_all` / `runAll` with one function per scenario id, and `na` (or `gaps`) for what the client cannot do. Gap keys are `id`, `id|model` or `id|variant`; a gap covers the whole row, so its note names the known check.
4. Run `bun examples/_harness/run.ts <client> --target scripted` and run it again: `git diff --exit-code` must pass.

## Snippet regions

A region is named `snippet` or `snippet-<name>`, with a kebab-case name, and each name appears once per file. The docs import one region with `<<< file#name`, so a duplicate name would make the import ambiguous, and a region that does not close, or nests in another, would include the wrong lines. `snippet` is the file's first region. A file with more than one names the others after what they show (`snippet-s1`, `snippet-raw`). `check-regions.ts` (the examples CI job) fails on any of these in the tracked files under `examples/`, except Markdown, whose prose quotes the markers.

## When a run is stale

A scripted run is stale when its scenarios, the checks, or the client's pinned version change. Rerun it and commit the new output; CI fails on a diff. A live run is never stale, only old: its directory name carries the date and commit, and a newer run is a new directory. Add `REPORT.md` for human notes. A live directory with only a `REPORT.md` is a historical record (`render.ts` `runKind`).

## Tests

`test/unit/examples-normalise.test.ts` covers the placeholder, URL, header, key and SSE rules and the writer's refusal. `test/unit/examples-harness.test.ts` covers the summary schema.

## Record-keeping

These rules come from the old `compat/README.md`, which the examples replace.

- Results are dated evidence. Keep old observations and add a new dated record when you retest. A per-client record starts from [`examples/_release/_template.md`](../_release/_template.md): client and exact versions, the plugboard commit, a scenario table, exact error text for each failure, and the raw request and response for any suspected plugboard bug, with your reasoning on whether it is a plugboard bug, a client quirk or model behaviour.
- When later code makes an old conclusion wrong, put a note at the top of that record that marks it superseded and says what changed. Do not rewrite the observation.
- Keep session chatter out of a record: who ran it, or what was or was not committed.
- Captures are sensitive. Quote synthetic excerpts in a record, never a raw capture. Transcripts under `runs/` are the normalised, redacted output of the writer (see Normalising above), not raw traffic.
- Clean up test history with `examples/_tools/sessions.py`. Every request leaves a history session filed under `<data root>/compat`. The tool deletes only sessions whose app matches `--app` (default `compat`), so use `--older-than` or explicit ids while another run shares the app.
