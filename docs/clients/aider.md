# Aider

A terminal pair-programming tool. It reaches any OpenAI-compatible endpoint through two environment variables.

## Connect

```sh
export OPENAI_API_BASE=http://127.0.0.1:4010/v1
export OPENAI_API_KEY=<your plugboard key>
aider --model openai/fast --weak-model openai/fast
```

The `openai/` prefix makes Aider use `OPENAI_API_BASE`; without it the request goes elsewhere. The same settings as files (`.aider.conf.yml` and `.env.example`) are in [examples/aider/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/aider).

## What works

Chat, edits and commit messages. Aider sends several requests per turn (repo map, edits, commit message).

## Limits

- Set `--weak-model` too, or Aider sends its weak calls to its own default model.
- Aider warns about models it doesn't know; `--no-show-model-warnings` silences that and changes nothing else.
