# SiYuan

SiYuan is a block-based personal knowledge base. Its AI features are writing help, Q/A chat and an agent, over OpenAI-compatible APIs.

## Plugboard options

Give SiYuan its own key. Docker needs a reachable address ([Serving other machines](../guides/serving-other-machines.md)).

```jsonc
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "siyuan": "{env:PLUGBOARD_KEY_SIYUAN}" },
    "models": ["opencode-go/glm-5.3-flash"],
    "aliases": { "writing": "opencode-go/glm-5.3-flash" },
    "apps": { "siyuan": { "models": ["writing"] } }
  }
}
```

## Connect

SiYuan reads one OpenAI provider from the environment at start-up:

| Variable | Value |
| --- | --- |
| `SIYUAN_OPENAI_API_BASE_URL` | `http://host.docker.internal:4010/v1` (with `/v1`) |
| `SIYUAN_OPENAI_API_KEY` | the `siyuan` key |
| `SIYUAN_OPENAI_API_MODEL` | `writing` |

The provider turns on when the base URL and model are both set. Optional: `SIYUAN_OPENAI_API_TIMEOUT`, `SIYUAN_OPENAI_API_MAX_TOKENS` and `SIYUAN_OPENAI_API_TEMPERATURE`.

A runnable compose file and env file are in [`examples/self-hosted/siyuan/`](https://github.com/jjjermiah/opencode-plugboard/blob/main/examples/self-hosted/siyuan/README.md).

## What works

- Writing help and Q/A chat, through the `writing` alias.
- The agent and editing models. The same provider feeds them. The agent uses tool calls, which plugboard supports. Tune it with the `SIYUAN_OPENAI_AGENT_*` variables (timeout, stream idle timeout, confirm timeout, retries, temperature, max completion tokens, max tool-call rounds).

## Limits

- Semantic search needs embeddings, which plugboard does not serve. It is off by default. Turn it on in the AI settings only after you point the embedding setting (`SIYUAN_OPENAI_EMBEDDING_API_KEY`, `SIYUAN_OPENAI_EMBEDDING_BASE_URL`, `SIYUAN_OPENAI_EMBEDDING_MODEL`) at another provider.
- The decision model points at an external service and is off by default. Leave it off unless you want that service.
- After the first start, open the AI settings and confirm the base URL and model.
- Set `SIYUAN_ACCESS_AUTH_CODE` (or `--accessAuthCode`). Without it, anyone who reaches the port can open your data.
- Use a workspace path that matches `PUID` and `PGID`.
