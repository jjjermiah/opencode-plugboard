# LangChain JS, live run at c97ac66

- Date: 2026-10-13 (UTC, as the harness names the directory; local time 2026-10-12).
- Server: the isolated dev server at 127.0.0.1:4010, plugboard 0.26.0 at `c97ac66` (version hand-corrected from 0.25.1: the harness read the worktree's package.json, not the server's) (the root checkout on `main`, committed before the server started). App key `compat`.
- Client: `@langchain/openai` 1.6.2 on Bun 1.4, `@langchain/core` 1.2.17.
- Verdict: partial. The result matches the scripted run.
  - The two gaps are S1 and S2 on `openai/gpt-5.6-luna#low`. LangChain's Responses path sets no `finish_reason`; the reply has `status: "completed"` (#104).
  - Everything else passes, including S5 and S6 on `openai/gpt-5.6-luna#low`, so ChatGPT was not quota-limited during this run.
- `jsonMode` on `fast` (S6, not checked): this run's `json_object` reply was `{"calories": 220, "protein_g": 15}`. The 2026-10-11 record got `{}`. One sample, so it does not settle whether the `{}` is gone.
- Mistake: the first attempt at this run used another app's key by mistake. Its output was discarded and is not committed. That attempt still made requests under that app on this server, so its usage counters include them.
