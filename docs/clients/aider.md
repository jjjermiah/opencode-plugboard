# Aider

<ExampleResult example="aider" />

Tested: `aider-chat` 0.86.2 (Python 3.12). Live record [2026-10-12 at `a67e176`](https://github.com/jjjermiah/opencode-plugboard/blob/main/examples/aider/runs/live/2026-10-12-a67e176/REPORT.md): one `--message` request went through plugboard on the isolated live dev server, and Aider exited 0 with `pong` in its answer. The example's runner makes the same request on the three models in the scripted run, and CI checks that run.

Aider is a terminal pair-programming tool. It connects to any OpenAI-compatible endpoint through two environment variables.

```sh
export OPENAI_API_BASE=http://127.0.0.1:4010/v1
export OPENAI_API_KEY=<a plugboard app key>
aider --model openai/fast
```

The `openai/` prefix tells Aider to use `OPENAI_API_BASE`. `fast` is an alias from the plugboard `aliases` option.

The same settings live in [`examples/aider/`](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/aider): `.aider.conf.yml` for the model and the flags, and `.env.example` (copy it to `.env`, which Git ignores) for the endpoint and key.

## Check it yourself

The example's runner (`examples/aider/run.sh`) is started by the harness, which sets the endpoint and a capture proxy:

```sh
bun examples/_harness/run.ts aider --target scripted
```

It makes a throwaway git repo, sends one message, and records the answer. It installs the pinned `aider-chat==0.86.2` from its `uv.lock` on first run.

## What was and was not tested

- Tested: one `--message` request answered through plugboard on `openai/fast` (live), and on three models in the scripted run.
- The example's message is `Reply with exactly: pong`, the S1 prompt, not an edit request. The scripted model answers plain text, so a file edit has nothing to check. The 2026-10-12 record used an edit request.
- Not tested: a file edit with a real model, the weak-model and commit-message requests as separate calls, architect mode, and the config file itself (the flags it names were run on the command line).
- Aider cannot see the wire `finish_reason` or usage, so the example's one check is "the answer contains pong". The captured transcript still holds those fields.

## Gotchas

- Always prefix the model with `openai/`. Without it Aider does not use `OPENAI_API_BASE`.
- Aider sends several requests per turn (repo map, edits, commit message). Set `--weak-model` to a plugboard id as well, or the weak calls go to Aider's default model.
- Aider warns about models it does not know. Plugboard ids are not in its metadata, so `no-show-model-warnings` silences those warnings; it does not change the requests.
