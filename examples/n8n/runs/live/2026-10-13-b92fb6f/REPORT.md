# n8n live run, 2026-10-13

- Runner: `PLUGBOARD_CHECKOUT=<main checkout> bun examples/_harness/run.ts n8n --target live --docker`, against the isolated dev server at `127.0.0.1:4010` (compat app key, read from the dev config without printing it). The run started from this worktree (PR #346 branch, after the merge of origin/main), and the checkout was set to the main checkout, which is where the dev server's code comes from.
- Plugboard commit: `b92fb6f` (`chore(release): 0.29.0`), the main checkout's HEAD when the run started. Version 0.29.0 is read from that commit (#335). Earlier in this session the main checkout was at `dba7182` (0.28.0); it moved during the session, and this run records what the checkout read.
- Dev server: `/plugboard/status` reports the server's start time (03:46 UTC) and no commit. Which code the server actually ran is not verified; the record names the checkout's HEAD, not a server commit.
- Client: n8n 2.42.6, image pinned in `docker-compose.yml`, Docker via Colima. Owner, API key and credential created by the runner in a throwaway volume, removed at the end.
- Verdict: partial. The only gap is S1 on the `responses` variant (issue #343: n8n records no finish reason for that path). Everything else passes on the models each scenario runs on, S6 included (the live model writes the output wrapper).
- E1 and E2 are n/a: n8n shows plugboard's message and LangChain's error class, not the error codes.
- Earlier record for the same workflows: `runs/live/2026-10-13-b824d17/REPORT.md` (its version labels were corrected by hand, see its REPORT).
