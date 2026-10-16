# OpenAI Agents SDK (JS)

The OpenAI Agents SDK for JavaScript (`@openai/agents`) against plugboard on the Responses API: plain text, a tool round trip, streaming, and structured output. Each scenario is one file you can copy, and the copyable part sits between `// #region snippet` markers. The SDK's default client, API and tracing are set once in `run.ts`; the scenarios build their models from that client. Part of the runnable-examples epic [#174](https://github.com/jjjermiah/opencode-plugboard/issues/174).

The Python sibling is [openai-agents](../openai-agents/README.md), which also runs Chat Completions. This example is Responses only.

## What it shows

| File | Scenario | What the snippet does |
| --- | --- | --- |
| `chat.ts` | S1 | the agent and one `run`; `modelFor` builds an `OpenAIResponsesModel` from the client, so the id goes out as given |
| `tools.ts` | S2 | a `get_weather` tool; the SDK runs it and sends the second turn itself |
| `stream.ts` | S3 | `run(agent, input, { stream: true })`, with the text deltas read from the events |
| `structured.ts` | S6 | `outputType` as a zod schema, sent as a `json_schema` text format |

Each file has an `import.meta.main` block only where it builds a client of its own (`chat.ts`); `run.ts` is the runner the harness starts. It prints results and writes nothing.

## Setup

```sh
cd examples/openai-agents-js
bun install --frozen-lockfile
```

The versions are exact pins (`@openai/agents` 0.20.0, `openai` 7.32.0, `zod` 4.6.6, `typescript` 7.0.2, `@types/bun` 1.4.2), locked in `bun.lock`. The example type checks with `bunx tsc --noEmit`.

## Run the whole example

Through the harness, which captures the traffic and writes the run under `runs/`:

```sh
bun examples/_harness/run.ts openai-agents-js --target scripted   # local, no provider
bun examples/_harness/run.ts openai-agents-js --target live       # the isolated server only
```

## Gotchas

- **The model id goes out as given.** The SDK reads a string model as a provider prefix, so `anthropic/claude-haiku-4-5` and `openai/gpt-5.6-luna#low` would be misread. `modelFor` passes a model object instead.
- **Tracing is off.** Without `setTracingDisabled(true)` the SDK would export traces to OpenAI.
- **There is no finish_reason.** The SDK does not expose the wire value. `chat.ts` derives it from the last response: `tool_calls` when it holds a function call, else `stop`. It is a mapping, not a read.

## Known gaps

Reported as `n/a`: S4 (streamed tool call), S5 (image), E1 and E2 (error paths) are not written for this example yet. S7 (model list) is `n/a` because the Agents SDK has no model-list call. Nothing is sent for them.

## Live run

The live run is `runs/live/2026-10-16-95261a4/`, against the isolated dev server at plugboard 0.41.0 (main `v0.41.0-4-g95261a4`). Every row on `anthropic/claude-haiku-4-5` and `openai/gpt-5.6-luna#low` passes. The `fast` rows fail with an upstream 429 (its quota is out), which is not a plugboard finding.
