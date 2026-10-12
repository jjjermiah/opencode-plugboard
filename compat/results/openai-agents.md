# OpenAI Agents SDK against plugboard

- Date / tester: 2026-10-12 / automated run (`bun run compat:python`)
- Client + exact version(s): `openai-agents` 0.23.1, `openai` 3.29.0 (`compat/py/uv.lock`)
- Plugboard commit: a67e176 (the code under test; this change touches no `src/`)
- Verdict: **PASS on the fake**, 8 of 8. **PASS live**, 8 of 8, on the isolated dev server at :4010 (see Live run).

Harness: `compat/py/clients/openai_agents.py`. Each scenario runs on the Responses API (the SDK default) and on Chat Completions (`set_default_openai_api("chat_completions")`).

## Scenarios

| Scenario | responses | chat_completions | Notes |
|---|---|---|---|
| text (`Runner.run_sync`) | pass | pass | `pong` |
| stream (`Runner.run_streamed`) | pass | pass | 2 text deltas, final `pong` |
| tool (`@function_tool`, round trip) | pass | pass | tool ran once with `city='Paris'`; final answer cites 18 C and cloudy |
| structured (`output_type=Answer`) | pass | pass | `Answer` instance returned |

## Live run

Run 2026-10-12 with `PLUGBOARD_URL=http://127.0.0.1:4010 bun run compat:python`, app `compat`, model `fast` (= `opencode-go/glm-5.3-flash`). All 8 scenarios passed. Tool calls were `['Paris']` on both paths. The answers came from the live model: the structured answer was `42` and the weather answer cited 18 C and cloudy. Streams had one text delta each (`text_deltas=1`).

An earlier attempt that day, before the listener was up: not run. `curl http://127.0.0.1:4010/healthz` failed with `curl: (7) Failed to connect to 127.0.0.1 port 4010`. The isolated dev OpenCode process is up (its own HOME, listening on :4196 for its web UI), but nothing listens on :4010, the port its config sets. Not restarted, per the dev-server rule. Re-run with `PLUGBOARD_URL=http://127.0.0.1:4010 PLUGBOARD_KEY=... bun run compat:python` once the listener is back.

## Suspected plugboard bugs

None found on the fake.

## Notes

- The fake answers from the request (`test/support/fake-server.ts`), so the structured answer is `{"answer": "pong"}`: a fake pass proves the schema reached the model and the SDK parsed the reply, not that the model answers well.
- Tracing is disabled in the harness (`set_tracing_disabled(True)`) so no request leaves for OpenAI.
