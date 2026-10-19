# PR-Agent

PR-Agent (Qodo) reviews pull requests with an LLM. Its commands are `/review`, `/describe`, `/improve` and `/ask`. It runs as a GitHub Action, a webhook server or a CLI.

## Plugboard options

Give PR-Agent its own key. The review sends the whole diff and asks for a YAML reply, so use a model with a long context. The runner must reach plugboard ([Serving other machines](../guides/serving-other-machines.md)).

```jsonc plugboard-options
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "pr-agent": "{env:PLUGBOARD_KEY_PR_AGENT}" },
    "models": ["anthropic/claude-sonnet-4-6"],
    "aliases": { "review": "anthropic/claude-sonnet-4-6" },
    "apps": { "pr-agent": { "models": ["review"] } }
  }
}
```

## Connect

Put the key in `.secrets.toml` (or in GitHub secrets for the Action):

```toml
[openai]
api_base = "http://192.0.2.10:4010/v1"
key = "<the pr-agent key>"
```

Or in the environment:

```sh
OPENAI__API_BASE=http://192.0.2.10:4010/v1
OPENAI__KEY=<the pr-agent key>
```

Use the address your runner reaches in place of `192.0.2.10`. Set the model in `configuration.toml`:

```toml
[config]
model = "openai/review"
fallback_models = ["openai/review"]
custom_model_max_tokens = 200000  # the context window of the model behind the alias
```

The `openai/` prefix routes through LiteLLM to an OpenAI-compatible URL. PR-Agent does not know a prefixed model's context size, so set `custom_model_max_tokens`.

A runnable env file is in [`examples/self-hosted/pr-agent/`](https://github.com/jjjermiah/opencode-plugboard/blob/main/examples/self-hosted/pr-agent/README.md).

## What works

`/review`, `/describe`, `/improve` and `/ask`, each as a chat request through `config.model`.

## Limits

- Keep the key in `.secrets.toml` or a secret store, not in the repo.
- A model that is not from OpenAI may need extra parameters. Run one `/review` before you rely on it.
