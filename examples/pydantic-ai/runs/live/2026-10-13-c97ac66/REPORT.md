# First live attempt: fail, example bug (not plugboard)

The first live run at `c97ac66` ended with one required failure: S6 on `anthropic/claude-haiku-4-5`, `JSONDecodeError: Expecting value: line 1 column 1 (char 0)`.

Cause: a bug in `structured.py`, not in plugboard. Claude answered with a text part and a `final_result` tool call in the same message. The observation read the first part, the text, and tried to parse it as JSON. pydantic-ai had already validated the tool call. The transcript (`transcripts/S6.anthropic-claude-haiku-4-5.json`) shows the tool call with `{"calories":220,"protein_g":14.5}`, which is correct.

Fix: the observation now reads the output tool's arguments first. The passing run is `2026-10-13-c97ac66-2`. This directory stays as the record of the failed attempt.

No gap was needed: the rerun passed everything. Plugboard answered every request with `200` (or the expected `401`/`404`) on this run.

## Version correction (hand edit)

`summary.json` and `summary.md` first said `plugboard 0.25.1`. The harness read the version from the example's checkout (this branch's base, `3e6960a`), not from the commit it names. `c97ac66` is the 0.26.0 release merge (`git show c97ac66:package.json`). The two summaries were corrected by hand to `0.26.0`; nothing else in this directory changed. The passing rerun, `2026-10-13-c97ac66-2`, got the same correction. Follow-up: the harness should read the version from the named commit.
