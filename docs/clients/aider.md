# Aider

Tested: `aider-chat` 0.86.2 (Python 3.12), 2026-10-12, against the scripted fake plugboard, with a scripted check rather than a harness. One `--message` request went through plugboard and streamed an answer. The live dev server was not reachable on that date, so no live result yet; see [compatibility](../compatibility.md#python-clients).

Aider is a terminal pair-programming tool. It connects to any OpenAI-compatible endpoint through two environment variables.

```sh
export OPENAI_API_BASE=http://127.0.0.1:4010/v1
export OPENAI_API_KEY=<a plugboard app key>
aider --model openai/fast
```

The `openai/` prefix tells Aider to use `OPENAI_API_BASE`. `fast` is an alias from the plugboard `aliases` option.

The same settings live in [`examples/aider/`](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/aider): `.aider.conf.yml` for the model and the flags, and `.env.example` (copy it to `.env`, which Git ignores) for the endpoint and key.

## Check it yourself

```sh
PLUGBOARD_URL=http://127.0.0.1:4010 PLUGBOARD_KEY=<app key> bash compat/py/clients/aider_check.sh
```

The script makes a throwaway git repo, asks for one change with `--message`, and prints one JSON line. It needs `uv`, and it installs `aider-chat==0.86.2` from PyPI on first run.

## What was and was not tested

- Tested: one `--message` request answered through plugboard on `openai/fast`. Aider also sent its repo map in the same request.
- Not tested: a file edit. The fake answers in plain text, so Aider's edit format (`whole` here) had nothing to apply. A real model's edit was not checked.
- Not tested: the weak-model and commit-message requests as separate calls, architect mode, and the config file itself (the flags it names were run on the command line).

## Gotchas

- Always prefix the model with `openai/`. Without it Aider does not use `OPENAI_API_BASE`.
- Aider sends several requests per turn (repo map, edits, commit message). Set `--weak-model` to a plugboard id as well, or the weak calls go to Aider's default model.
- Aider warns about models it does not know. Plugboard ids are not in its metadata, so `no-show-model-warnings` silences those warnings; it does not change the requests.
