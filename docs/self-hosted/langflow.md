# Langflow

Langflow is a visual builder for agents and flows. Its language model and embedding components use model providers you configure in the UI or with env vars.

| | |
| --- | --- |
| Upstream | [langflow-ai/langflow](https://github.com/langflow-ai/langflow) (about 155.5k stars) |
| Config source | `docs/docs/Components/bundles-openai-compatible.mdx` in the same repo |
| Plugboard API | `/v1/models` for discovery, `/v1/chat/completions` for chat |
| Status | Chat only. Embedding models appear in the list but plugboard serves none. docs-verified, not run (checked 2026-10-11) |

## Plugboard options

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

## Langflow config

Set these in Langflow's environment (a shell, a compose file, or the process that starts Langflow):

```sh
OPENAI_COMPATIBLE_BASE_URL=http://host.docker.internal:4010/v1
OPENAI_COMPATIBLE_API_KEY=<the langflow app key>
LANGFLOW_SSRF_ALLOWED_HOSTS=host.docker.internal
```

Or in the UI: open your profile menu, select **Settings**, then **Model Providers**, select **OpenAI Compatible**, and set **Base URL** and **API Key**. Save. Langflow calls the endpoint's `/v1/models` to validate it and to discover models. Enable the models you want. Then pick **OpenAI Compatible** and a discovered model in a Language Model component.

The env var names are the ones in the bundle docs' table. Langflow's SSRF protection blocks loopback and private addresses by default. `host.docker.internal` resolves to a private address on Docker, so the allowlist is needed. The docs say to add the host before saving the base URL. This was inferred from the docs' rule and not run.

A runnable copy is not included. Langflow's docker run line was not checked against the current image name.

## What works and what does not

- **Language model components**: through the `chat` alias.
- **Embedding model components**: listed under **Embedding Models** after discovery. Plugboard serves no embeddings, so do not pick one of these. Use an embedding provider you run yourself.
- **Agents and tool-using flows**: plugboard passes tools through. Not checked against a flow in this page.

## Gotchas

- Discovery lists whatever `/v1/models` returns for the key. Keep the app's `models` list short, so the Language Model dropdown stays usable.
- If the base URL is accepted but discovery finds no models, check the `models` and `apps` policy first.

## Sources

- [OpenAI Compatible bundle](https://github.com/langflow-ai/langflow/blob/main/docs/docs/Components/bundles-openai-compatible.mdx)
