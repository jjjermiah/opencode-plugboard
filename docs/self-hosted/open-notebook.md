# Open Notebook

Open Notebook is a self-hosted research notebook: sources, notes, transformations and chat over your material. Its AI runs on providers you set in the UI.

## Plugboard options

Give Open Notebook its own key. Docker needs a reachable address ([Serving other machines](../guides/serving-other-machines.md)).

```jsonc plugboard-options
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "open-notebook": "{env:PLUGBOARD_KEY_OPEN_NOTEBOOK}" },
    "models": ["opencode-go/glm-5.3-flash"],
    "aliases": { "chat": "opencode-go/glm-5.3-flash" },
    "apps": { "open-notebook": { "models": ["chat"] } }
  }
}
```

## Connect

The **OpenAI Compatible** provider takes one base URL per configuration. In the UI:

1. Add a configuration under **OpenAI Compatible**. Set a name, the **Base URL** `http://host.docker.internal:4010/v1`, and the `open-notebook` key as the API key.
2. Click **Test**. It calls `GET <Base URL>/models`, and plugboard answers with the models this app may use.
3. If `chat` is missing from the list, type its id in **Discover Models** and add it.
4. Add `chat` as a language model.

Set the provider in the database configuration. The `OPENAI_COMPATIBLE_BASE_URL` and `OPENAI_COMPATIBLE_API_KEY` env vars are a deprecated fallback.

## What works

Language models for chat and transformations, through the `chat` alias.

## Limits

- Adding sources needs an embedding model, which plugboard does not serve. Add a second configuration for an embedding provider (Ollama or another OpenAI-compatible server). Each model remembers which configuration it came from.
- Speech to text and text to speech are not served. Open Notebook's docs point to Speaches for local speech.
- Model calls time out after `ESPERANTO_LLM_TIMEOUT` (180 seconds by default). Raise it for a slow model.
