# PR-Agent

PR-Agent (Qodo) reviews pull requests with an LLM. Its commands are `/review`, `/describe`, `/improve` and `/ask`. It runs as a GitHub Action, a webhook server or a CLI.

Upstream: [source](https://github.com/The-PR-Agent/pr-agent), [docs](https://docs.qodo.ai/code-review).

## Plugboard options

Give PR-Agent its own key. The review sends the whole diff and asks for a YAML reply, so use a model with a long context. The runner must reach plugboard ([Serving other machines](../guides/serving-other-machines.md)).

```jsonc plugboard-options
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "pr-agent": "{env:PLUGBOARD_KEY_PR_AGENT}" },
    "models": ["anthropic/claude-sonnet-4-6"],
    "aliases": { "review": "anthropic/claude-sonnet-4-6" },
    "apps": { "pr-agent": { "allowedModels": ["review"] } }
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

<<< @/../examples/pr-agent/.env.example#snippet{ini}

Use the address your runner reaches in place of `192.0.2.10`. Set the model in `configuration.toml`:

```toml
[config]
model = "openai/review"
fallback_models = ["openai/review"]
custom_model_max_tokens = 200000  # the context window of the model behind the alias
```

The `openai/` prefix routes through LiteLLM to an OpenAI-compatible URL, and plugboard receives the model name without it (`review`). PR-Agent does not know a prefixed model's context size. Without `custom_model_max_tokens` the review stops before it sends a request, with `Ensure openai/review is defined in MAX_TOKENS ... or set a positive value for it in config.custom_model_max_tokens`.

## Review a local branch

PR-Agent's `local` git provider needs no hosted pull request. It compares the checked-out branch with a target branch in the current repository and writes the review to `review.md`. It takes the target branch where the other providers take a pull request URL. The same settings as above, as environment variables:

<<< @/../examples/pr-agent/run.py#snippet

A review that fails still writes `review.md`, with the text `Failed to review PR`. Read the file for the model's findings.

A runnable version that builds a throwaway repository with a `main` and a feature branch is in [`examples/pr-agent/`](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/pr-agent/README.md). It needs no GitHub token.

## What works

`/review`, `/describe`, `/improve` and `/ask`, each as a chat request through `config.model`, on a local branch or on GitHub, GitLab, Bitbucket and the other hosted providers, which take the same model settings.

## Limits

- Keep the key in `.secrets.toml` or a secret store, not in the repo.
- A model that is not from OpenAI may need extra parameters. Run one `/review` before you rely on it.
