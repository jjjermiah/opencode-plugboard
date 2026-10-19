# Langflow

Langflow is a visual builder for agents and flows. Its language model components use providers you set in the UI or with env vars.

## Plugboard options

Give Langflow its own key. Docker needs a reachable address ([Serving other machines](../guides/serving-other-machines.md)).

```jsonc
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "langflow": "{env:PLUGBOARD_KEY_LANGFLOW}" },
    "models": ["opencode-go/glm-5.3-flash"],
    "aliases": { "chat": "opencode-go/glm-5.3-flash" },
    "apps": { "langflow": { "models": ["chat"] } }
  }
}
```

Keep the app's `models` list short. Langflow lists everything `/v1/models` returns for the key.

## Connect

Set these in Langflow's environment:

```sh
OPENAI_COMPATIBLE_BASE_URL=http://host.docker.internal:4010/v1
OPENAI_COMPATIBLE_API_KEY=<the langflow key>
LANGFLOW_SSRF_ALLOWED_HOSTS=host.docker.internal
```

Langflow blocks private addresses by default, so the allowlist entry is required. Add it before you save the base URL.

Or use the UI: profile menu, **Settings**, **Model Providers**, **OpenAI Compatible**, then set **Base URL** and **API Key**. Langflow calls `/v1/models` to validate the endpoint and discover models. Enable the models you want, then pick **OpenAI Compatible** and the model in a Language Model component.

## What works

- Language Model components, through the `chat` alias.
- Agents and flows that use tools. Plugboard passes tools through.

## Limits

- Embedding models appear under **Embedding Models** after discovery, but plugboard serves none. Use an embedding provider you run.
- If the base URL is accepted but no models appear, check the `models` and `apps` policy.
