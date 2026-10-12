# DSPy against plugboard

- Date / tester: 2026-10-12 / automated run (`bun run compat:python`)
- Client + exact version(s): `dspy` 3.4.0, `litellm` 1.105.0, `openai` 2.54.0 (`compat/py-litellm/uv.lock`)
- Plugboard commit: a67e176 (the code under test; this change touches no `src/`)
- Verdict: **PASS on the fake**, 3 of 3. **Live: not run**, the isolated server was not listening on :4010 (see below).

Harness: `compat/py/clients/dspy_client.py`, `dspy.LM("openai/fast", api_base=..., api_key=..., cache=False)`.

## Scenarios

| Scenario | Result | Notes |
|---|---|---|
| predict (`question -> answer`) | pass | `answer='pong'` |
| chain-of-thought | pass | `answer='pong'`, a `reasoning` field present |
| typed-output (pydantic `Answer`) | pass | `Answer(answer='pong')` |

## Failure seen during the run, and its cause

The typed scenario first failed on the fake, before the fake was changed:

```
AdapterParseError: LM response cannot be serialized to a JSON object.
... Expected to find output fields in the LM response: [answer]
```

The cause was the fake, not plugboard: it answered `pong` for every field, and the typed output needs a JSON object. The fake now answers `{"answer": "pong"}` when the prompt carries a JSON schema (`test/support/fake-server.ts`). Both runs' requests were the client's own; the fix was on the test side.

## Live run

Not run. `curl http://127.0.0.1:4010/healthz` failed with `curl: (7) Failed to connect to 127.0.0.1 port 4010`. Not restarted, per the dev-server rule.

## Suspected plugboard bugs

None found on the fake. Not tested: streaming (`dspy.streamify`), and a real model's own JSON fallback (the fake supplies it).

## Notes

- With the fake, DSPy's ChatAdapter answer (`[[ ## answer ## ]]` blocks) is accepted for `Predict` and `ChainOfThought`. The typed output also passes through the same adapter path in this run.
