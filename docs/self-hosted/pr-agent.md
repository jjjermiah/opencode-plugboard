# PR-Agent

PR-Agent (Qodo) reviews pull requests with an LLM. Its commands are `/review`, `/describe`, `/improve` and `/ask`. It runs as a GitHub Action, a webhook server or a CLI.

| | |
| --- | --- |
| Upstream | [qodo-ai/pr-agent](https://github.com/qodo-ai/pr-agent) (about 13.4k stars) |
| Config source | `docs/docs/usage-guide/changing_a_model.md` in the same repo, section "OpenAI like API" |
| Plugboard API | `/v1/chat/completions`, through LiteLLM's `openai/` route |
| Status | Works for review and describe through chat. No embeddings used. Gitea and Forgejo not checked. docs-verified, not run (checked 2026-10-12) |

## Plugboard options

```jsonc
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "pr-agent": "{env:PLUGBOARD_KEY_PR_AGENT}" },
    "models": ["opencode-go/glm-5.3-flash", "anthropic/claude-sonnet-4-6"],
    "aliases": {
      "review": "anthropic/claude-sonnet-4-6"
    },
    "apps": { "pr-agent": { "models": ["review"] } }
  }
}
```

`review` must accept a long prompt: PR-Agent sends the whole diff and asks for JSON.

## PR-Agent config

The upstream doc gives the OpenAI-like settings. Put the key in `.secrets.toml`, or in the environment:

```toml
# .secrets.toml
[openai]
api_base = "http://192.0.2.10:4010/v1"
key = "<the pr-agent app key>"
```

```bash
OPENAI__API_BASE=http://192.0.2.10:4010/v1
OPENAI__KEY=<the pr-agent app key>
```

Set the model in `configuration.toml`:

```toml
[config]
model = "openai/review"
fallback_models = ["openai/review"]
custom_model_max_tokens = 200000  # the context window of the model behind the alias
```

The upstream doc says to keep the `openai/` prefix on the model name, which sends the request through LiteLLM's OpenAI-compatible path. A prefixed name is not in PR-Agent's token table, so `custom_model_max_tokens` is required.

`192.0.2.10` is a placeholder. Use the address that PR-Agent's runner can reach, and bind plugboard to it (see [Networking from containers](../self-hosted.md#networking-from-containers)).

A runnable env file is in [`examples/self-hosted/pr-agent/`](https://github.com/jjjermiah/opencode-plugboard/blob/main/examples/self-hosted/pr-agent/README.md).

## What works and what does not

- **Review, describe, improve, ask**: through `config.model`. Each runs a chat request.
- **Embeddings**: none in the commands. Nothing to route to plugboard.
- **Structured output**: whether PR-Agent's default prompts need JSON mode or tools is not checked. Test one `/review` before relying on it.
- **Gitea and Forgejo**: not checked. The upstream doc covers the model setup only, not the git provider.

## Gotchas

- Keep the key in `.secrets.toml` or a secret store, not in the repo. The upstream doc says to set keys in `.secrets.toml` for the CLI, or in GitHub `Settings > Secrets and variables` for the GitHub App or Action.
- The `openai/` prefix is required. Without it, LiteLLM does not know which API to call.
- The upstream doc says a model not from OpenAI may need extra keys or parameters. Whether the plugboard alias needs any is inferred, not run.

## Sources

- [Changing a model, OpenAI like API](https://github.com/qodo-ai/pr-agent/blob/main/docs/docs/usage-guide/changing_a_model.md) (fetched 2026-10-12)
