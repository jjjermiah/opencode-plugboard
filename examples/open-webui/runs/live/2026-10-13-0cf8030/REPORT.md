# Open WebUI live run, 2026-10-13

- Runner: `bun examples/_harness/run.ts open-webui --target live --docker` against the isolated dev server at `127.0.0.1:4010` (compat app key, read from the dev config without printing it).
- Plugboard commit: `0cf8030` (the checkout HEAD the dev server runs; plugboard 0.28.0; the version was corrected by hand from the 0.27.0 the harness wrote, because the harness read its own checkout's package.json, fixed in #335).
- Client: Open WebUI 0.12.0, image pinned in `docker-compose.yml`, Colima (Docker 29.5.2). Background generation off.
- Verdict: pass. All required scenarios pass on `fast`, `anthropic/claude-haiku-4-5` and `openai/gpt-5.6-luna#low` where the scenario runs on them. E2 is n/a (see the README).
- S2 and S4 read the tool call and answer from the chat record Open WebUI stores. The upstream turns are in the transcripts.
- E1 is the Verify button's `POST /openai/verify` with a wrong key. Its 401 reaches plugboard as `GET /v1/models`, so it sits in `transcripts/_background.json`, not in E1's own slice.
- Not verified: browser rendering, file upload, RAG and web search, multiple connections.
