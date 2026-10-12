# SparkyFitness

SparkyFitness is a self-hosted nutrition, fitness and health tracker. Its AI features read a global OpenAI-compatible service that an admin sets up once.

| | |
| --- | --- |
| Upstream | [CodeWithCJ/SparkyFitness](https://github.com/CodeWithCJ/SparkyFitness) (upstream, not re-checked in this pass) |
| Config source | a working deployment, checked 2026-10-11. Upstream docs were not used for these steps. |
| Plugboard API | `/v1/chat/completions`, with tools |
| Status | Works. Tool calls were verified with this app (see [Tool calls](../clients/any-app.md#tool-calls)). |

## Plugboard options

```jsonc
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "sparkyfitness": "{env:PLUGBOARD_KEY_SPARKYFITNESS}" },
    "models": ["anthropic/claude-sonnet-4-6"],
    "aliases": { "chat": "anthropic/claude-sonnet-4-6" },
    "apps": { "sparkyfitness": { "models": ["chat"] } }
  }
}
```

## SparkyFitness config

In the admin settings, open **Global AI Settings** and add a service with these values:

- **Type**: `openai_compatible`
- **Base URL**: `http://<plugboard-host>:4010/v1`. Use the address the SparkyFitness server reaches, over the LAN or a tailnet. Plugboard speaks plain HTTP, so keep this on a network you trust (see [Remote access](../remote-access.md)).
- **Model**: `chat`, or `anthropic/claude-sonnet-4-6`.
- **API key**: the plugboard app key.

The app stores the key encrypted in its database, and it needs its own encryption key to read it back. Keep that key and the app's secrets backed up. Without them the stored provider key cannot be read.

On the owner's deployment a global service with a LAN URL needed no extra setting. Check your own version before assuming the same.

## What works and what does not

- **Chat**: through the `chat` alias.
- **Tool calls**: work through the normal Chat Completions loop. SparkyFitness runs the tools and sends the results back.
- **Structured output and images**: not checked for this app.

## Gotchas

- If plugboard is not running, chat fails. After an OpenCode restart the port stays closed until something touches the server. See [Warm-up](../warm-up.md).
- Plugboard's `limits` and `budgets` apply per app. Set them if you want a cap on SparkyFitness calls.

## Sources

- [Any OpenAI-compatible app](../clients/any-app.md)
- [Remote access](../remote-access.md)
