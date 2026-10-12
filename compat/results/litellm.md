# LiteLLM (as a client) against plugboard

- Date / tester: 2026-10-12 / automated run (`bun run compat:python`)
- Client + exact version(s): `litellm` 1.105.0, `openai` 2.54.0 (`compat/py-litellm/uv.lock`). Not in the same environment as `openai-agents`, which needs `openai` 3.x.
- Plugboard commit: a67e176 (the code under test; this change touches no `src/`)
- Verdict: **PASS on the fake**, 4 of 4. **Live: not run**, the isolated server was not listening on :4010 (see below).

Harness: `compat/py/clients/litellm_client.py`, calls `litellm.completion` with `model="openai/fast"` and `api_base` set to the plugboard `/v1` root.

## Scenarios

| Scenario | Result | Notes |
|---|---|---|
| completion | pass | `pong`, `finish_reason` stop, total_tokens 18 |
| stream | pass | 4 chunks, text `pong` |
| tool (round trip) | pass | `get_weather` called with `city='Paris'`; the second turn cites 18 C and cloudy |
| structured (`response_format=Answer`) | pass | content parses as `Answer` |

## Live run

Not run. `curl http://127.0.0.1:4010/healthz` failed with `curl: (7) Failed to connect to 127.0.0.1 port 4010`. The isolated dev OpenCode process is running, but nothing listens on :4010. Not restarted, per the dev-server rule.

## Suspected plugboard bugs

None found on the fake.

## Notes

- The fake answers from the request, so the structured answer is `{"answer": "pong"}`: a pass proves the schema reached the model and LiteLLM parsed the reply, not that a real model answers well.
- LiteLLM may add default parameters of its own. The harness did not inspect `x-plugboard-dropped-params`; not checked.
