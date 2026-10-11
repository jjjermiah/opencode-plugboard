# Release-candidate acceptance

Not run yet. Fill this in once, against the commit that will be tagged, on an isolated server (see [docs/development.md](../../docs/development.md)). The per-client files next to it are dated records from earlier commits; this one is the record for the release.

- Date / tester:
- Plugboard commit (`git rev-parse --short HEAD`):
- OpenCode version (tested on 2.0.26; the peer range allows 2.0.x patch releases):
- Plugin options used (keys redacted):
- Verdict: PASS | FAIL | PARTIAL

## Behaviour beyond pong

Each row needs the exact request, what was observed and the time. "Pass" with no observation does not count.

| # | Check | How | Result | Observation |
|---|---|---|---|---|
| R1 | Plain chat, non-stream and stream, with usage | `compat/py/smoke.py`, `compat/js/smoke.ts`, then S1 and S3 | | |
| R2 | Client cancels mid-stream | Close the connection during an SSE response; the turn stops and no session stays busy | | |
| R3 | Slow reader | A client that reads the stream slowly or stalls; memory stays bounded and the request ends | | |
| R4 | Config reload while a request runs | Touch the config during a request; the request finishes or fails cleanly, and the next request is served | | |
| R5 | Several tool calls in one turn | One prompt that needs two tools; both calls come back with distinct ids and the follow-up turn accepts both results | | |
| R6 | Tools plus structured output | `tools` and `response_format` `json_schema` in one request ([#34](https://github.com/jjjermiah/opencode-plugboard/issues/34)) | | |
| R7 | Auth and Host checks | Wrong key gives 401, `/healthz` needs no key, a loopback bind rejects a foreign `Host` | | |
| R8 | Reachable from another host | The recipe in the [any-app page](../../docs/clients/any-app.md#reaching-plugboard-from-another-host-or-container) works end to end | | |

## Client sweep

Run each client's script from [`compat/README.md`](../README.md#running). A script that exits nonzero is a failure here.

| Client | Command | Exit code | Notes |
|---|---|---|---|
| OpenAI Python | `uv run python openai_py.py` | | |
| OpenAI JS | `bun openai_js.ts` | | |
| LangChain Python | `uv run python langchain_py.py` | | |
| LangChain JS | `bun langchain_js.ts` | | |
| pydantic-ai | `uv run python pydantic_ai_check.py` | | |
| Vercel AI SDK | `bun vercel_ai.ts compat` | | |
| Open WebUI, n8n | [docker/README.md](../docker/README.md) | | |

## Failures and open items

Exact error text, raw request and response, and whether it is a plugboard bug, a client quirk or model behaviour.
