# Nextcloud Assistant (integration_openai)

Nextcloud's AI features run through the `integration_openai` app. It connects any number of OpenAI-compatible services, and an admin picks the models each service exposes for each task.

Upstream: [source](https://github.com/nextcloud/integration_openai), [docs](https://docs.nextcloud.com/server/latest/admin_manual/ai/).

## Plugboard options

Give Nextcloud its own key. `vision` handles image analysis and OCR, so it must accept images. Docker needs a reachable address ([Serving other machines](../guides/serving-other-machines.md)).

```jsonc plugboard-options
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "nextcloud": "{env:PLUGBOARD_KEY_NEXTCLOUD}" },
    "models": ["opencode-go/glm-5.3-flash", "anthropic/claude-sonnet-4-6"],
    "aliases": {
      "text": "opencode-go/glm-5.3-flash",
      "vision": "anthropic/claude-sonnet-4-6"
    },
    "apps": { "nextcloud": { "models": ["text", "vision"] } }
  }
}
```

## Connect

In the admin settings, open **Artificial intelligence** and add a service:

| Field | Value |
| --- | --- |
| Base URL | `http://host.docker.internal:4010/v1` (the address your Nextcloud server reaches) |
| API key | the `nextcloud` key |
| Models | `text` and `vision` for the text modality. Leave the image, transcription and speech modalities off |

Skip personal keys unless you want per-user quotas.

## What works

- Text tasks: free prompt, chat, summarize, headline, topics, reformulate, change tone, proofread, translate and the rest of the text task list.
- Chat with tools. Plugboard returns the tool calls and Nextcloud runs them ([Tool calls](../clients/any-app.md#tool-calls)).
- Image analysis and OCR, through the `vision` alias.

## Limits

- Image generation, transcription and text to speech are not served. Use another service in the same app for them.
- Run 4 background job workers on the Nextcloud server so AI tasks do not wait on each other.
- Nextcloud's quotas are per service. Plugboard's `limits` and `budgets` apply separately.
