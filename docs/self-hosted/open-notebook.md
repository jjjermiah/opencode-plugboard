# Open Notebook

Open Notebook is a self-hosted notebook for research: sources, notes, transformations and chat with your material. Its AI runs on a provider set in its UI.

| | |
| --- | --- |
| Upstream | [lfnovo/open-notebook](https://github.com/lfnovo/open-notebook) (about 40.1k stars) |
| Config source | `docs/5-CONFIGURATION/openai-compatible.md` and `environment-reference.md` in the same repo |
| Plugboard API | `/v1/chat/completions` for language models, `/v1/models` for the model list |
| Status | Chat only. Open Notebook needs an embedding model to add sources, and plugboard serves none. docs-verified, not run (checked 2026-10-11) |

## Plugboard options

```jsonc
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

## Open Notebook config

Open Notebook's **OpenAI Compatible** provider takes one base URL per configuration. In the UI:

1. Add a configuration under the OpenAI Compatible provider. Set a name, the **Base URL** `http://host.docker.internal:4010/v1` (from inside Docker), and the plugboard app key as the API key.
2. Click **Test**. The docs say the test calls `GET <Base URL>/models`. Plugboard answers that route with the models this app may use. If the list is empty, check the `models` policy.
3. If the model is missing from the list, type its exact id in **Discover Models** and add it.
4. Add the `chat` model as a language model.

The docs say the legacy `OPENAI_COMPATIBLE_BASE_URL` and `OPENAI_COMPATIBLE_API_KEY` variables are a deprecated fallback. Use the database configuration, and migrate with the in-app option the docs describe.

## What works and what does not

- **Language models** (chat and transformations): through the `chat` alias.
- **Embeddings**: needed to add sources. Plugboard serves none. Run an embedding provider yourself (Ollama or another OpenAI-compatible server) in a second configuration. Each model remembers which configuration it came from.
- **Speech-to-text and text-to-speech**: not possible through plugboard. The docs point to Speaches for local speech.

## Gotchas

- Model calls time out after `ESPERANTO_LLM_TIMEOUT`, which defaults to 180 seconds. A slow model shows a timeout message. Raise the variable, or use a faster model.
- The docs' "Base URL from inside Docker" table uses `host.docker.internal` for a server on the host, which is the case here.

## Sources

- [OpenAI Compatible provider](https://github.com/lfnovo/open-notebook/blob/main/docs/5-CONFIGURATION/openai-compatible.md)
- [Environment reference](https://github.com/lfnovo/open-notebook/blob/main/docs/5-CONFIGURATION/environment-reference.md)
