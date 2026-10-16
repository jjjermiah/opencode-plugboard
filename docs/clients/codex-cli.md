# Codex CLI

Verified: docs only. The `wire_api` values, the `env_key` provider field and `--profile` were checked against developers.openai.com (the Codex config sample and config reference). `codex exec` was not checked against the docs. Not run: the dev server at `127.0.0.1:4010` was down, so a Codex task against plugboard is still to do.

Codex CLI is OpenAI's terminal coding agent. It is the Responses-only client: its config accepts `responses` as the only `wire_api` value. So Codex needs plugboard's `POST /v1/responses` route ([Responses API](../responses.md)), and a gateway that only serves Chat Completions will not work with it.

## Plugboard options

One app for Codex, and an alias for the model it calls:

```jsonc
"options": {
  "keys": { "codex-cli": "{env:PLUGBOARD_KEY_CODEX_CLI}" },
  "models": ["openai/gpt-5.6-luna#low"],
  "aliases": { "fast": "openai/gpt-5.6-luna#low" }
}
```

Swap the model for one your OpenCode server is signed in to. ChatGPT models need a variant (`#low` here), as [configuration](../configuration.md#models) explains.

## Codex config

In `~/.codex/config.toml`:

```toml
model = "fast"
model_provider = "plugboard"

[model_providers.plugboard]
name = "Plugboard"
base_url = "http://127.0.0.1:4010/v1"
env_key = "PLUGBOARD_KEY_CODEX_CLI"
wire_api = "responses"
```

Then export the key and run Codex:

```sh
export PLUGBOARD_KEY_CODEX_CLI="<your app key>"
codex
codex exec "list the files in this directory"
```

- `base_url` ends in `/v1`. Codex appends `/responses`.
- `env_key` names the environment variable Codex reads the key from. Codex sends it as a bearer token.
- `codex --profile NAME` layers `$CODEX_HOME/NAME.config.toml` over this file. Keep the provider in the base file, as above, and a profile only needs to set `model` or `model_provider`.

A copyable version is in [examples/codex-cli/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/codex-cli).

## Features exercised

- `/v1/responses` with streaming, and function tool calls, which Codex's shell tool uses. Each call comes back to Codex unexecuted.
- Reasoning: plugboard accepts reasoning items in the input and drops them. It does not return reasoning text unless the server sets `reasoningOutput` (since 0.36.0). Codex is not tested with that setting on.

## Quirks

- Plugboard keeps no conversation. `previous_response_id` and `conversation` are rejected with 400 `unsupported_parameter`. This page assumes Codex resends the whole conversation on each turn, as the issue that asked for it states. That was not checked against Codex's source. If a turn fails with a 400 that names `previous_response_id`, this is the cause.
- Plugboard accepts only `function` tools. A tool Codex sends with type `custom` (a freeform tool) is refused with 400. Which tool types Codex sends depends on the model, and was not checked. A live run should confirm a file edit goes through.
- Hosted tools (`web_search`, `file_search`, `code_interpreter`, and the like) are refused with 400. They run on OpenAI's side, which plugboard does not reach.
- `include` and `parallel_tool_calls` are accepted and ignored. `store: false` keeps nothing, so its output items cannot be referenced later (#426). The response always reports `store: false`.
