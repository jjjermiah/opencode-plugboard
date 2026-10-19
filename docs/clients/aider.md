# Aider

A terminal pair-programming tool. It reaches any OpenAI-compatible endpoint through two environment variables.

## Connect

Put the endpoint and key in `.env`, next to your config:

<<< @/../examples/aider/.env.example#snippet{ini}

Then set the models in `.aider.conf.yml` and run `aider`:

<<< @/../examples/aider/.aider.conf.yml#snippet

The `openai/` prefix makes Aider use `OPENAI_API_BASE`; without it the request goes elsewhere. Both files are in [examples/aider/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/aider).

## What works

Chat, file edits and commit messages. Aider picks the edit format for the model id: `whole` for `fast` and for ids it does not know, `diff` (SEARCH/REPLACE blocks) for Claude ids. Plugboard passes either through as text, and Aider applies it to your files. Aider sends several requests per turn (repo map, edits, commit message).

## Limits

- Set `--weak-model` too, or Aider sends its weak calls to its own default model.
- Aider warns about models it doesn't know; `--no-show-model-warnings` silences that and changes nothing else.
