# Mattermost AI plugin

The Mattermost AI plugin adds AI assistants (called agents) to Mattermost. Each agent uses a service, and the OpenAI Compatible service takes any endpoint that speaks the OpenAI API.

| | |
| --- | --- |
| Upstream | [mattermost/mattermost-plugin-ai](https://github.com/mattermost/mattermost-plugin-ai) (plugin repo, 254 stars) |
| Config source | `docs/providers.md` in the same repo |
| Plugboard API | `/v1/responses` by default, or `/v1/chat/completions` with the setting turned off |
| Status | Configured through the Responses API, with Chat Completions as the fallback. docs-verified, not run (checked 2026-10-11) |

## Plugboard options

```jsonc
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

## Mattermost config

The plugin's providers page says to select **OpenAI Compatible** in the **AI Service** dropdown of the plugin's service settings, then set:

- **API URL**: `http://host.docker.internal:4010/v1`, or the address your Mattermost server reaches. The plugin's doc says to append `/v1` for Ollama, and plugboard needs it too.
- **API Key**: the plugboard app key. The doc marks this optional, but plugboard requires it because `keys` is set.
- **Organization ID**: leave empty.
- **Use Responses API**: on by default. It uses `/v1/responses`. Turn it off only if a turn fails, because the doc says it is for "endpoints that do not implement the Responses API".
- A model name: use the alias `chat`.

The exact menu path in the System Console was not checked against a running server. Use the labels above.

## What works and what does not

- **Chat and agents**: through the Responses API, the default. Not run here.
- **Tools**: not checked against this plugin. Plugboard passes tools through, so the answer depends on whether the agent sends them.
- **Semantic search**: the plugin's README mentions a PostgreSQL pgvector store for semantic search. The README does not say whether that search needs an embedding model. Check before you turn it on, because plugboard serves no embeddings.
- **Speech and images**: not checked. Treat them as not possible through plugboard until checked.

## Gotchas

- Mattermost's server reaches plugboard from its own host or container. A loopback bind does not work from a container. See [Networking from containers](../self-hosted.md#networking-from-containers).
- If agent turns fail, switch "Use Responses API" off and retest the same agent. Plugboard serves Chat Completions on the same base URL.

## Sources

- [Providers](https://github.com/mattermost/mattermost-plugin-ai/blob/master/docs/providers.md)
- [Plugin README](https://github.com/mattermost/mattermost-plugin-ai/blob/master/README.md)
