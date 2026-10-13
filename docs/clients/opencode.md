# OpenCode

Verified: source, 2026-10-13, against OpenCode v2.0.27 (config schema `packages/schema/src/config/provider.ts`, native provider map `packages/core/src/aisdk-native.ts`). Live: **not passed yet**. See [Live check](#live-check).

OpenCode can use plugboard as a provider in two ways. Pick a dialect for the provider, then declare the models it serves.

- **As a provider** (this page): OpenCode runs the model call and its tools on your machine, and plugboard only answers the model call.
- **As an attached server** (`opencode attach`): tools run on the hub. Not verified in this pass.

## Dialects

Use the Anthropic dialect when you can. Plugboard's Messages route keeps reasoning and thinking replay. Chat Completions and Responses drop reasoning ([#255](https://github.com/jjjermiah/opencode-plugboard/issues/255)).

### Anthropic (preferred)

OpenCode's built-in `anthropic` provider takes a base URL in `settings`. The hub's Messages route is `POST /v1/messages`, and the SDK adds the path, so the base URL ends in `/v1`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "anthropic": {
      "settings": { "baseURL": "http://127.0.0.1:4010/v1" },
      "models": {
        "fast": { "name": "fast", "limit": { "context": 200000, "output": 8000 } }
      }
    }
  }
}
```

The key is not in the file. OpenCode reads `ANTHROPIC_API_KEY`, and the hub accepts it as `x-api-key`. The hub's app key is the value, so keep it out of the config.

The issue body wrote `options.baseURL`. The v2.0.27 schema uses `settings.baseURL`. Use `settings`.

### OpenAI-compatible (Chat Completions)

Custom providers use the `@ai-sdk/openai-compatible` package. It is mapped to OpenCode's native provider in v2.0.27. It is **not** in v2.0.26's native map, and a v2.0.26 client fails with `Unsupported package for <provider>/<model>`. Each model needs `package` as well as the provider:

```jsonc
{
  "provider": {
    "plugboard": {
      "package": "@ai-sdk/openai-compatible",
      "name": "plugboard",
      "settings": { "baseURL": "http://127.0.0.1:4010/v1", "apiKey": "{env:PLUGBOARD_KEY}" },
      "models": {
        "fast": { "name": "fast", "package": "@ai-sdk/openai-compatible", "limit": { "context": 200000, "output": 8000 } }
      }
    }
  }
}
```

## Declaring limits and cost

A custom provider with no `limit` gets OpenCode's 200k context and 32k output, and a zero `cost`. That miscounts compaction and hides spend. Declare both per model. `limit` is in tokens. `cost` is USD per million tokens, with an optional context tier (`tier.size` in tokens) for models that price long prompts higher.

Generate the block from a hub instead of typing it:

```sh
PLUGBOARD_KEY=<app key> bun .github/scripts/opencode-models.ts http://127.0.0.1:4010
```

The script reads `GET /v1/models` and prints `limit` and `cost` per id. It needs the `context_length`, `max_output_tokens` and `pricing` fields from [#376](https://github.com/jjjermiah/opencode-plugboard/issues/376). A hub that predates them gets empty entries, so the script prints `{}` for each id. Facts it does not know are left out, never zero.

## Tool limit

OpenCode sends about 21 built-in tools, plus every tool from every MCP server you run. Plugboard's `maxTools` defaults to 64. A request over the cap gets `400 too_many_tools` that names the option. Raise it on the hub if your client runs MCP servers:

```jsonc
"options": { "maxTools": 128 }
```

It is a global option. An app can only lower it (`apps.<name>.maxTools`).

## Prompt cache

On the hub, turn on the anchor so the provider's prompt cache keeps hitting across turns:

```jsonc
"promptCache": { "affinity": "anchor", "scope": "app" }
```

Without it, a cache read can miss on every turn. See [Prompt-cache affinity](../configuration.md#prompt-cache-affinity).

## Live check

Run on 2026-10-13 against the dev server at `127.0.0.1:4010` (plugboard main, not the branch). The scratch client was an isolated home that was deleted after the run. Results:

| Dialect | CLI | Prompt | Result |
|---|---|---|---|
| openai-compatible | v2.0.26 | `reply with exactly: pong` | `Unsupported package for plugboard/fast` (no native map in v2.0.26) |
| Anthropic | v2.0.26 | `reply with exactly: pong` | `invalid x-api-key`, with `ANTHROPIC_API_KEY` set, with and without `settings.apiKey`, and with `ANTHROPIC_BASE_URL` |
| Anthropic | (direct) | `curl` `POST /v1/messages` with `x-api-key` | `200`, `pong` |
| Tool prompt | — | — | not run (blocked by the two above) |

The hub accepts the same key on `/v1/messages` with `x-api-key`, so the rejection is on the client side. I did not find the cause. The likely suspects are that v2.0.26 does not honour `settings.baseURL` for the built-in provider, or that it sends a different key. Neither is confirmed.

Open: rerun this table with OpenCode v2.0.27 and confirm the built-in provider takes `settings.baseURL` and `ANTHROPIC_API_KEY`. The tool prompt and the `maxTools` 400 check also wait on that run.
