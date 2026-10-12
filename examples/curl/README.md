# curl

One request per API, in plain shell: Chat Completions, Responses, Anthropic Messages, Gemini, legacy completions and models. Each file runs on its own with `curl` and `jq`, and its copyable part sits between `# region snippet` markers. This is the only client example for the Anthropic Messages and Gemini routes. Part of the runnable-examples epic [#174](https://github.com/jjjermiah/opencode-plugboard/issues/174).

## What it shows

| File | API | Scenarios |
| --- | --- | --- |
| `chat.sh` | `POST /v1/chat/completions` | S1 plain chat, S2 tool round trip, S3 stream with usage, S4 streaming tool call, S5 image, S6 structured output, E1 wrong key, E2 unknown model |
| `responses.sh` | `POST /v1/responses` | S1 |
| `messages.sh` | `POST /v1/messages`, key in `x-api-key` | S1, S2, S3 |
| `gemini.sh` | `POST /v1beta/models/<model>:generateContent`, key in `x-goog-api-key` | S1, S2, S3 (`streamGenerateContent`) |
| `completions.sh` | `POST /v1/completions` (legacy) | S1 |
| `models.sh` | `GET /v1/models` | S7 |

`S1` runs on every API, `S2` and `S3` on chat, Messages and Gemini; the rest is chat only. `run.ts` runs each one against the scripts and writes the result to `runs/`.

## Setup

```sh
export PLUGBOARD_BASE_URL=http://127.0.0.1:4010/v1   # ends in /v1
export PLUGBOARD_KEY=<your app key>
```

`PLUGBOARD_BASE_URL` ends in `/v1`. The Gemini route is at the origin, so `gemini.sh` strips the `/v1` itself.

## Run one file

```sh
bash chat.sh S1 fast
bash messages.sh S2 anthropic/claude-haiku-4-5
bash models.sh S7 -
```

Each prints one JSON object of observations, the same names the checks use.

## Run the whole example

Through the harness, which captures the traffic and writes the run:

```sh
bun examples/_harness/run.ts curl --target scripted   # local, no provider
bun examples/_harness/run.ts curl --target live       # the isolated server only
```

The runner is `run.ts`. It calls the shell files through the shared helpers in `examples/_harness/ts`.

## Gotchas

- **Tool arguments are a JSON string.** `chat.sh` parses `function.arguments` with `fromjson`. Anthropic's `tool_use.input` is an object, and `messages.sh` reads it as one.
- **Turn 2 needs the assistant's message as it came back.** The tool result carries the same call id as turn 1 (`tool_call_id`, `tool_use_id`, or the Gemini `functionResponse` name).
- **Gemini model ids in the path are percent-encoded.** `anthropic/claude-haiku-4-5` and `openai/gpt-5.6-luna#low` become `%2F` and `%23`. `gemini.sh` does this with `@uri`.
- **Streams are accumulated.** A stream may send a tool call in one delta or several; `chat.sh` joins the argument deltas before it parses them.
- **`E1` uses a fake key on purpose.** It is written into the request and never into the run files, so a reader can see the 401.
- **`fast` reasons first.** It routes to a reasoning model, so a small `max_tokens` is spent on reasoning and the reply comes back empty with `stop_reason: max_tokens`. The first live run failed for this reason at 64 tokens (its record stays in `runs/live/2026-10-12-a38860b/`). `messages.sh` uses 1024.
- **`/v1/usage` is not here.** It needs the admin key, not an app key, and is covered with the other plugboard routes.

## Known gaps

None on the scripted target. A live run records its own gaps per target in `runs/live/`.
