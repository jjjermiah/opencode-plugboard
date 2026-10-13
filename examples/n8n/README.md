# n8n with plugboard

Runs [n8n](https://n8n.io) 2.42.6 in Docker and points an OpenAI credential at plugboard. The workflows in [`workflows/`](workflows/) use OpenAI Chat Model nodes; each scenario is a webhook on one of them.

Tested against n8n 2.42.6: see [docs/clients/n8n.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/clients/n8n.md) for the setup steps and gotchas.

## What this example shows

The runner starts n8n, creates an owner, a public API key and an OpenAI credential whose base URL is plugboard, imports and activates the workflows, and calls each scenario's webhook. The observations come from the webhook answer and from the execution's run data (`GET /api/v1/executions/{id}`): n8n keeps the model's finish reason and token usage there, and the tool call the AI Agent made.

| File | Scenario | Workflow |
| --- | --- | --- |
| [`chat.ts`](chat.ts) | S1 plain chat (`chat`, and the node's default `responses`) | `pb-s1-chain`, `pb-s1-responses-default` |
| [`tools.ts`](tools.ts) | S2 tool call, then the tool result | `pb-s2-agent` |
| [`stream.ts`](stream.ts) | S3 streaming text | `pb-s3s4-stream-agent` |
| [`stream_tools.ts`](stream_tools.ts) | S4 streaming tool call | `pb-s3s4-stream-agent` |
| [`image.ts`](image.ts) | S5 image as a data URL | `pb-s5-image` |
| [`structured.ts`](structured.ts) | S6 structured output | `pb-s6-structured` |
| [`models.ts`](models.ts) | S7 list models | the credential's model dropdown |

E1 (wrong key) and E2 (unknown model) are `n/a`: n8n shows plugboard's message and LangChain's error class (`MODEL_AUTHENTICATION`, `MODEL_NOT_FOUND`), not the error codes `invalid_api_key` and `model_not_found`. The status is in the message text only, so the code cannot be read.

`n8n.ts` is the shared client: the API key and session, the webhook call, the execution poll, and the readers for model turns and the tool call. `run.ts` does the setup and runs the scenarios.

## Settings that matter

- **Leave Use Responses API off.** Plugboard serves `/v1/responses`, and plain chat works on it. Only S1 was run on that path: tools, streaming and structured output were not tried with the setting on, so do not assume they work. [docs/clients/n8n.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/clients/n8n.md) gives the same advice. Every workflow here sets it off except `s1-responses-default.json`, which the `responses` variant of S1 uses.
- **The Responses variant checks less.** n8n's Responses node records no `finish_reason`, and only its own estimate of usage (`tokenUsageEstimate`), not plugboard's usage. S1 (responses) checks the answer text only. The other two checks are listed under `unobserved` in `run.ts`, and the summary note says so (#343, a permanent n8n limitation).
- **Gaps cover the whole row.** A gap turns any failing check of its scenario into `gap`, not only the known one. The note and issue name the known check. The two Responses checks left out are not gaps: they are left out of that row, and the note says so.
- **Structured Output Parser** asks the model for JSON with an `output` wrapper. A model that answers bare JSON fails the parse. The live model writes the wrapper.
- **Background requests**: n8n calls `GET /v1/models` when the credential is tested and when the model dropdown opens. Those land in `transcripts/_background.json`.

## Run the example

Docker is required, so run it with `--docker`. Without it `run.ts all` skips this example.

Scripted, deterministic, committed under `runs/scripted/`:

```sh
bun examples/_harness/run.ts n8n --target scripted --docker
```

Live, only against the isolated server from [docs/development.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/development.md):

```sh
PLUGBOARD_BASE_URL=http://127.0.0.1:4010/v1 PLUGBOARD_KEY=<compat key> \
  bun examples/_harness/run.ts n8n --target live --docker
```

Live runs write `runs/live/<date>-<commit>/`. The 2026-10-11 record is `runs/live/2026-10-11-f351307/REPORT.md`, kept unchanged from the earlier run.

## Run one file

Start n8n, create the owner, an API key and an OpenAI credential pointed at plugboard, and import the workflows (`workflows/*.json`, with the credential id in place of `__CRED_ID__`). Then run a scenario file on its own:

```sh
N8N_BASE=http://127.0.0.1:5678 N8N_API_KEY=<api key> N8N_CREDENTIAL_ID=<credential id> MODEL=fast \
  bun examples/n8n/tools.ts
```

S7 also needs the owner's session cookie in `N8N_COOKIE`.

## Gotchas

- **The tool argument is named by the model.** The Code tool's schema has one string input named `input`, and models send it as `input`. The runner reads the value, not the key.
- **Tool call ids are n8n's.** The `tool_call_id` in S2 and S4 is the id of n8n's tool action, not the provider's `call_` or `toolu_` id.
- **Streaming ends with an `end` frame.** The S3 check is named after `[DONE]`; for n8n it reads the `end` frame of the NDJSON stream.
- **Errors come back as 500.** A failed workflow answers `{"message":"Error in workflow"}`. The cause is in the execution's error.
- **Model list duplicates.** n8n collapses plugboard's duplicate ids, so the dropdown shows each model once.
- **Sampling options and JSON mode.** The workflows `s6b-jsonobject.json` and `s8-options.json` are kept from the old record. They are not scenarios here; see the record for their results.
