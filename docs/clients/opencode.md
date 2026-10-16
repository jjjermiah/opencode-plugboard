# OpenCode

Verified: run, 2026-10-13, OpenCode 2.0.27, against plugboard main on an isolated server. The configs and results are in [Live results](#live-results).

OpenCode can use plugboard as a provider in two ways:

- **As a provider** (this page): OpenCode runs the model call and its tools on your machine. Plugboard answers the model call.
- **As an attached server** (`opencode attach`): tools run on the hub. Not verified on this page.

## Dialects

Use the Anthropic dialect when you can. Plugboard's Messages route keeps reasoning and thinking replay with no setting. Chat Completions and Responses drop reasoning by default. Since 0.36.0, `reasoningOutput: true` returns it on those two routes (opt-in, see [Reasoning output](../configuration.md#reasoning-output)). Whether OpenCode sends that reasoning back on the next turn was not checked here ([#255](https://github.com/jjjermiah/opencode-plugboard/issues/255)).

Custom and built-in providers are declared under `providers` (plural) in the OpenCode config.

### Anthropic (preferred)

The built-in `anthropic` provider takes its base URL in `settings`. The Messages route is `POST /v1/messages`, and the SDK adds the path, so the base URL ends in `/v1`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "providers": {
    "anthropic": {
      "settings": { "baseURL": "http://127.0.0.1:4010/v1" },
      "models": {
        "fast": { "name": "fast", "limit": { "context": 200000, "output": 8000 } }
      }
    }
  }
}
```

Give the key through `ANTHROPIC_API_KEY`, or set `"apiKey": "{env:PLUGBOARD_KEY}"` under `settings`. The hub accepts the key as `x-api-key`.

### OpenAI-compatible (Chat Completions)

Set `package` to `@ai-sdk/openai-compatible` on the provider:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "providers": {
    "plugboard": {
      "name": "plugboard",
      "package": "@ai-sdk/openai-compatible",
      "settings": { "baseURL": "http://127.0.0.1:4010/v1", "apiKey": "{env:PLUGBOARD_KEY}" },
      "models": {
        "fast": { "name": "fast", "limit": { "context": 200000, "output": 8000 } }
      }
    }
  }
}
```

Run with `-m plugboard/fast` or `-m anthropic/fast`. Replace `fast` with any id `GET /v1/models` lists.

## Declaring limits and cost

A custom provider with no `limit` gets OpenCode's 200k context and 32k output, and a zero `cost`. That miscounts compaction and hides spend. Declare both per model. `limit` is in tokens. `cost` is USD per million tokens. A context tier (`tier.size`, in tokens) prices long prompts higher.

Generate the block from a hub instead of typing it:

```sh
PLUGBOARD_KEY=<app key> bun .github/scripts/opencode-models.ts http://127.0.0.1:4010
```

The script reads `GET /v1/models` and prints `limit` and `cost` for each id. It skips ids with a `#variant` suffix, because OpenCode reads `provider/model#variant` as a model plus a variant and would send the base model. For a variant, declare the base id. The script needs the `context_length`, `max_output_tokens` and `pricing` fields from [#376](https://github.com/jjjermiah/opencode-plugboard/issues/376). A hub without them gets empty entries. Facts the hub does not list are left out, never zero.

## Tool limit

OpenCode v2.0.27 sends 12 built-in tools: `edit`, `glob`, `grep`, `question`, `read`, `shell`, `skill`, `subagent`, `webfetch`, `websearch`, `write`, `execute`. By default MCP tools go through the single Code Mode `execute` tool, so a request stays well under the default cap of 64.

A request is refused only when a server sets `codemode: false` and sends its tools directly. Then the total can pass 64. The refusal names the option:

- OpenAI dialect: `Error: Request has 72 tools; plugboard allows 64 (option 'maxTools')`
- Anthropic dialect: `tools: 72 tools; plugboard allows 64 ...`

Raise `maxTools` on the hub:

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

## Scratch checks

Use `--standalone` for a scratch check, for example `opencode run --standalone -m plugboard/fast "reply with exactly: pong"`. Without it, `opencode run` connects to or starts the managed background service, which is not your scratch config.

## Live results

Verified: run, 2026-10-13, OpenCode 2.0.27. Plugboard main, dev server at `127.0.0.1:4010`, scratch HOME, `opencode run --standalone`.

| Check | Result |
|---|---|
| `run -m anthropic/fast "reply with exactly: pong"` | `pong` |
| `run -m plugboard/fast "reply with exactly: pong"` | `pong` |
| Tool prompt on both providers: read a file, answer with its word | the read tool ran; answer `plum-7421` |
| 72 tools sent (60-tool MCP server, `codemode: false`), both dialects | `400`, refused with the messages in [Tool limit](#tool-limit) |
| Generated `models` block, 170 entries with tiers, loaded in OpenCode | loads; `opencode models --standalone` lists 171 `plugboard/*` models |
| Read-tool run on `plugboard/fast`, with the generated `openai/gpt-6.1-sol` cost | `cost: 0.020484` (10117 input tokens at $2/M, 25 output at $10/M); without cost it is 0 |

Not verified: `opencode attach`.
