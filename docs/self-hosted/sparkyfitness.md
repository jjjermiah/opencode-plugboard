# SparkyFitness

SparkyFitness is a self-hosted nutrition, fitness and health tracker. Its AI assistant uses a global OpenAI-compatible service that an admin sets up once.

## Plugboard options

Give SparkyFitness its own key. Plugboard must bind an address the SparkyFitness server reaches ([Serving other machines](../guides/serving-other-machines.md)).

```jsonc plugboard-options
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

## Connect

In the admin settings, open **Global AI Settings** and add a service:

| Field | Value |
| --- | --- |
| Type | `openai_compatible` |
| Base URL | `http://<plugboard-host>:4010/v1`, over your LAN or tailnet |
| Model | `chat` |
| API key | the `sparkyfitness` key |

Plugboard speaks plain HTTP, so keep this on a network you trust ([Remote access](../remote-access.md)).

## What works

Chat, and tool calls. SparkyFitness runs the tools and sends the results back ([Tool calls](../clients/any-app.md#tool-calls)).

## Limits

- SparkyFitness stores the provider key encrypted and needs its own encryption key to read it. Back up that key with the app's secrets, or you must re-enter the provider key.
- Chat fails while plugboard is down. After an OpenCode restart the port stays closed until something touches the server ([Warm-up](../warm-up.md)).
- Set `limits` or `budgets` for the `sparkyfitness` app if you want a cap on its calls.
