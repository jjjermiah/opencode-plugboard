# OpenCode

Another OpenCode (on your laptop, say) can use a plugboard hub as its provider. That OpenCode runs the tools on its own machine; the hub only answers the model calls.

## Anthropic dialect (preferred)

The Messages route keeps reasoning and replays signed thinking with no extra setting. Point the built-in `anthropic` provider at the hub:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "providers": {
    "anthropic": {
      "settings": { "baseURL": "http://127.0.0.1:4010/v1", "apiKey": "{env:PLUGBOARD_KEY}" },
      "models": {
        "fast": { "name": "fast", "limit": { "context": 200000, "output": 8000 } }
      }
    }
  }
}
```

## OpenAI-compatible dialect

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

This dialect drops reasoning unless the hub sets `reasoningOutput: true` ([Reasoning output](../configuration.md#reasoning-output)).

Providers go under `providers` (plural). Run with `-m anthropic/fast` or `-m plugboard/fast`; use any name `GET /v1/models` lists.

## Limits and cost

A custom model without `limit` gets 200k context and 32k output, and without `cost` its spend shows as zero. Generate both from the hub:

```sh
PLUGBOARD_KEY=<app key> bun .github/scripts/opencode-models.ts http://127.0.0.1:4010
```

It prints a `models` block with `limit` and `cost` for each model from `/v1/models` (run it from a plugboard checkout). Models with a `#variant` suffix are skipped: declare the base model.

## Tools

OpenCode sends about 12 tools, with MCP tools behind the single Code Mode `execute` tool, so requests stay under `maxTools` (64). A server with `codemode: false` sends its tools directly and can go over; raise `maxTools` on the hub if requests are refused with `Request has N tools; plugboard allows 64`.

## Prompt cache

Turn on the anchor on the hub so the provider's prompt cache keeps hitting across turns:

```jsonc plugboard
"promptCache": { "affinity": "anchor", "scope": "app" }
```

See [Prompt-cache affinity](../configuration.md#prompt-cache-affinity).

## Scratch checks

`opencode run --standalone -m plugboard/fast "reply with exactly: pong"` uses your scratch config instead of the managed background service.
