# LangChain JS, live run at c97ac66, with the S1 and S2 variants

- Date: 2026-10-13 (UTC, as the harness names the directory).
- Server: the isolated dev server at 127.0.0.1:4010, plugboard 0.26.0 at `c97ac66` (the root checkout on `main`, committed before the server started). App key `compat`.
  - The harness wrote `0.27.0` because it reads the worktree's `package.json`, which is 0.27.0 after the merge with `origin/main`. Hand-corrected to 0.26.0 in `summary.json` and `summary.md`.
- Client: `@langchain/openai` 1.6.2 on Bun 1.4, `@langchain/core` 1.2.17.
- This run is a second live run of the same commit. It adds the `chat` and `auto` variants of S1 and S2, which the first run (`2026-10-13-c97ac66`) did not have.
- Verdict: partial.
  - `chat` (`ChatOpenAICompletions`, `/v1/chat/completions`) passes S1 and S2 on every model, including `openai/gpt-5.6-luna#low`.
  - `auto` (`ChatOpenAI`) on `openai/gpt-5.6-luna#low` takes `/v1/responses`. The reply has `status: "completed"`, but LangChain sets no `finish_reason`, so S1 and S2 are `gap` (#104). The tool-call and text checks pass.
  - Everything else passes, including S5 and S6 on the ChatGPT model, so there was no quota limit.
- The first live run (`2026-10-13-c97ac66`) has the same results for the non-variant S1 and S2, and the same S5 and S6 results.
