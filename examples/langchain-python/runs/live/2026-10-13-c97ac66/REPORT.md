# langchain-python · live · 2026-10-13 · plugboard c97ac66

Human notes on this run. The files beside this report are the harness output and are not edited.

- Target: isolated dev server at `http://127.0.0.1:4010`, which loads the main checkout at `c97ac66` (plugboard 0.26.0). Client: `langchain-openai` 1.7.0 on Python 3.13.
- Verdict: pass. Every scenario passed on every model, including `openai/gpt-5.6-luna#low`. ChatGPT was not quota-limited on this run.
- Directory date is the UTC date of the run start (2026-10-13). Local time was still 2026-10-12.
- `json_mode` on `fast` (S6, not checked by the contract): returned valid JSON, `{"calories": 230, "protein_g": 15}` (transcript `S6.fast.json`, third exchange). The `{}` answer in the 2026-10-11 record did not reproduce. One sample, so this is not a fix claim.
- `function_calling` on all three models: forced `Meal` tool call, pass.
- No gaps and no n/a. No issues filed.
- Earlier record, unchanged: `../2026-10-11-3fcedc7/REPORT.md`.
