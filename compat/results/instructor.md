# Instructor against plugboard

- Date / tester: 2026-10-12 / automated run (`bun run compat:python`)
- Client + exact version(s): `instructor` 1.17.0, `openai` 2.54.0 (`compat/py-litellm/uv.lock`)
- Plugboard commit: a67e176 (the code under test; this change touches no `src/`)
- Verdict: **PASS on the fake**, 3 of 3. **Live: not run**, the isolated server was not listening on :4010 (see below).

Harness: `compat/py/clients/instructor_client.py`. Each scenario extracts a `Person(name: str, age: int)` with `max_retries=0`, so a failed validation shows instead of being retried.

## Scenarios

| Scenario | Result | Notes |
|---|---|---|
| tools-mode (`Mode.TOOLS`) | pass | a forced tool call, arguments validated into `Person` |
| json-schema-mode (`Mode.JSON_SCHEMA`) | pass | `response_format` `json_schema`, parsed into `Person` |
| partial-stream (`create_partial`) | pass | one partial, the full object |

## Live run

Not run. `curl http://127.0.0.1:4010/healthz` failed with `curl: (7) Failed to connect to 127.0.0.1 port 4010`. Not restarted, per the dev-server rule.

## Suspected plugboard bugs

None found on the fake. Not tested: the validation-retry path (it needs a model that first returns an invalid value; the fake is deterministic), and the tools-plus-schema combination that the client issue reports (#225).

## Notes

- The fake fills every schema field with a sample value (`name` gets `pong`, `age` gets 1), so a pass proves the schema round trip, not that a model extracts the right person.
