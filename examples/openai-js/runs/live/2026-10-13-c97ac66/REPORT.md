# Live run at c97ac66 (earlier record)

- Plugboard: 0.26.0 at `c97ac66`, the 0.26.0 release merge. The `plugboard.version` in `summary.json` and `summary.md` said 0.25.1 when the run was written, because the harness read the version from the branch's package.json. Corrected by hand to 0.26.0 in this commit; nothing else in the record changed.
- Superseded by `../2026-10-13-50219b1/`, which runs the current S3 (with and without usage). The S3 transcript here has only the usage call.
- Result at the time: 17 of 17 checks pass on `fast`, `anthropic/claude-haiku-4-5` and `openai/gpt-5.6-luna#low`.
