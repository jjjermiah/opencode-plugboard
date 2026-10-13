# n8n live run, 2026-10-13

- Runner: `bun examples/_harness/run.ts n8n --target live --docker` against the isolated dev server at `127.0.0.1:4010` (compat app key, read from the dev config without printing it).
- Plugboard commit: `b824d17`, the checkout HEAD when the run started (plugboard 0.27.0). Earlier Open WebUI live runs recorded `0cf8030`; the checkout moved in between.
- Client: n8n 2.42.6, image pinned in `docker-compose.yml`, Docker via Colima. Owner, API key and credential created by the runner in a throwaway volume.
- Verdict: partial. One gap: the S1 Responses variant (see issue #343). Everything else passes on the models each scenario runs on.
- S1 (chat) runs with Use Responses API off on all three models. S1 (responses) runs the node's default (on): the answer is right, but n8n records no finish reason and only an estimated usage.
- S2 and S4 read the tool call from the AI Agent's run metadata: tool name, the Code tool's single argument ("Paris"), and n8n's action id. The id is n8n's, not the provider's `call_` id.
- S6 passes live: the live model writes the `output` wrapper n8n's Structured Output Parser needs. The scripted target does not (issue #344).
- E1 and E2 are n/a: n8n shows plugboard's message and LangChain's error class, not the error codes `invalid_api_key` and `model_not_found`.
- Not verified: the n8n UI, Chat Hub, memory sub-nodes, parallel tool calls, reasoning_effort, extra body. The old record's sampling-option (S8) and json_object (S6b) workflows are kept in `workflows/` but are not scenarios here.
