# Examples harness

Every client example in `examples/<client>/` checks itself against plugboard and commits what it saw. This directory holds the shared part: the scenarios, the scripted model and server, the capture proxy, the orchestrator and the writer. Tracked in [#174](https://github.com/jjjermiah/opencode-plugboard/issues/174).

## Targets

| Target | Upstream | Use |
| --- | --- | --- |
| `scripted` | `scripted-server.ts`, plugboard over loopback with `scripted-model.ts` | CI and determinism. Output is byte-identical between runs |
| `live` | an isolated OpenCode server with real providers ([docs/development.md](../../docs/development.md)) | Real model behaviour. Never your everyday OpenCode |

The scripted model answers only the exact prompts in `_shared/scenarios.json`. Anything else gets an error, so a scenario cannot pass by accident.

## Scenarios

`_shared/scenarios.json` is the single list. Each scenario has an id, its exact prompt, the models it runs on, whether it is `required`, the routes that count as its own traffic, and the checks applied to the observations a runner reports.

| Id | Scenario | Required |
| --- | --- | --- |
| S1 | plain chat, non-stream | yes |
| S2 | tool call, then a tool-result turn | yes |
| S3 | streaming text, with and without usage | yes |
| S4 | streaming tool call | yes |
| S5 | image as data URL (answer says red) | yes |
| S6 | structured output (as text and as a forced tool) | yes |
| S7 | list models | yes |
| E1 | wrong key (401 `invalid_api_key`) | no |
| E2 | unknown model (404 `model_not_found`) | no |

Model ids: `fast`, `anthropic/claude-haiku-4-5` and `openai/gpt-5.6-luna#low`. In a directory name `/` and `#` become `-`.

## Scripted server by hand

```sh
bun examples/_harness/scripted-server.ts --port 4790
```

It prints `PLUGBOARD_BASE_URL` (ending in `/v1`) and `PLUGBOARD_KEY`, then stays up until it is killed or its stdin closes. With the key from that output:

```sh
curl -s http://127.0.0.1:4790/v1/chat/completions -H "Authorization: Bearer sk-plug-scripted-examples" \
  -H 'Content-Type: application/json' -d '{"model":"fast","messages":[{"role":"user","content":"Reply with exactly: pong"}]}'
```

## Summary schema

`run.schema.json` is the source of truth for `summary.json`. `golden/summary.json` is a hand-written example that the unit test in `test/unit/examples-harness.test.ts` validates.

## Still to come

The orchestrator (`run.ts`), capture proxy, normaliser, writer and runner helpers are the next part of #174 (#176). This README gains the commands, redaction rules and how to add an example then.
