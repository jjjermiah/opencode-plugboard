# Mattermost AI plugin

The Mattermost AI plugin adds AI assistants (agents) to Mattermost. Each agent uses a service, and the **OpenAI Compatible** service takes any endpoint that speaks the OpenAI API.

## Plugboard options

Give Mattermost its own key. Docker needs a reachable address ([Serving other machines](../guides/serving-other-machines.md)).

```jsonc plugboard-options
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "mattermost": "{env:PLUGBOARD_KEY_MATTERMOST}" },
    "models": ["opencode-go/glm-5.3-flash", "anthropic/claude-sonnet-4-6"],
    "aliases": { "chat": "anthropic/claude-sonnet-4-6" },
    "apps": { "mattermost": { "models": ["chat"] } }
  }
}
```

## Connect

In the plugin's service settings, choose **OpenAI Compatible** in the **AI Service** dropdown, then set:

| Field | Value |
| --- | --- |
| API URL | `http://host.docker.internal:4010/v1`, or the address your Mattermost server reaches (with `/v1`) |
| API Key | the `mattermost` key |
| Organization ID | empty |
| Use Responses API | on (the default). It uses `/v1/responses` |
| Model | `chat` |

## What works

Chat and agents through the Responses API.

## Limits

- If agent turns fail, turn **Use Responses API** off. The agent then uses Chat Completions on the same base URL.
- The plugin's semantic search uses a pgvector store. If it needs an embedding model, plugboard does not serve one, so use another provider for it.
