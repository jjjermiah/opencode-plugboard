# Aider against plugboard

- Date / tester: 2026-10-12 / automated run (`bash compat/py/clients/aider_check.sh`)
- Client + exact version(s): `aider-chat` 0.86.2, Python 3.12, run with `uv tool run` (not pinned in a lock: it is a terminal tool, and its dependency tree is about 300 packages)
- Plugboard commit: a67e176 (the code under test; this change touches no `src/`)
- Verdict: **PASS on the fake** for one request. **Live: not run**, the isolated server was not listening on :4010 (see below).

## Scenario

One `--message 'Change hello.py so it prints pong.'` in a throwaway git repo, with `--model openai/fast --weak-model openai/fast`, `--yes-always` and no auto-commits. Aider sent its repo map and the edit request through `OPENAI_API_BASE` (plugboard `/v1`).

| Check | Result |
|---|---|
| Aider exits 0 | pass |
| Answer contains `pong` | pass (the fake answers in text) |
| File edited | no. The fake returns no SEARCH/REPLACE block, so nothing to apply; not a failure of the check |

Aider's summary for the run: `Model: openai/fast with whole edit format`, `Repo-map: using 1024 tokens`, `Tokens: 730 sent, 1 received`.

## Live run

Not run. `curl http://127.0.0.1:4010/healthz` failed with `curl: (7) Failed to connect to 127.0.0.1 port 4010`. Not restarted, per the dev-server rule.

## Suspected plugboard bugs

None found.

## Notes

- The issue asks for an edit through plugboard. This run only proves the request path and streaming to a text answer. An edit needs a model that writes an edit block; that check is for a live run.
- Aider's dependency tree is large. It was not pinned in a lock file, so a later run may resolve differently. Pin it when it is wired into a job.
