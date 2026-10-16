# SiYuan

SiYuan is a block-based personal knowledge base. Its AI features are writing help and Q/A chat over OpenAI-compatible APIs.

| | |
| --- | --- |
| Upstream | [siyuan-note/siyuan](https://github.com/siyuan-note/siyuan) (about 46.7k stars) |
| Config source | `kernel/conf/ai.go` at [fb3355f](https://github.com/siyuan-note/siyuan/blob/fb3355f07d22bff36f1d785999fd5ded6a90d468/kernel/conf/ai.go), and the Docker section of its README |
| Plugboard API | `/v1/chat/completions` (SiYuan's default protocol for an OpenAI provider) |
| Status | Works for writing, chat, Q/A and the agent through plugboard. Semantic search needs an embedding provider beside plugboard, and it is off by default. Source-checked at [7a7430d](https://github.com/siyuan-note/siyuan/tree/7a7430d) (2026-10-15), not run |

## Plugboard options

```jsonc
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "siyuan": "{env:PLUGBOARD_KEY_SIYUAN}" },
    "models": ["opencode-go/glm-5.3-flash", "anthropic/claude-sonnet-4-6"],
    "aliases": {
      "writing": "opencode-go/glm-5.3-flash"
    },
    "apps": { "siyuan": { "models": ["writing"] } }
  }
}
```

## SiYuan config

SiYuan reads one OpenAI provider from the environment when it starts. The variables are in `kernel/conf/ai.go`:

| Variable | Value |
| --- | --- |
| `SIYUAN_OPENAI_API_BASE_URL` | Base URL, ending in `/v1`, for example `http://host.docker.internal:4010/v1` |
| `SIYUAN_OPENAI_API_KEY` | The plugboard app key for SiYuan |
| `SIYUAN_OPENAI_API_MODEL` | The alias, `writing` |

The provider is enabled only when `SIYUAN_OPENAI_API_BASE_URL` and `SIYUAN_OPENAI_API_MODEL` are both set. Its protocol is left empty, which SiYuan normalizes to Chat Completions. Optional: `SIYUAN_OPENAI_API_TIMEOUT`, `SIYUAN_OPENAI_API_MAX_TOKENS` and `SIYUAN_OPENAI_API_TEMPERATURE`.

A runnable compose file and env file are in [`examples/self-hosted/siyuan/`](https://github.com/jjjermiah/opencode-plugboard/blob/main/examples/self-hosted/siyuan/README.md).

## What works and what does not

- **Writing and chat**: through the `writing` alias.
- **Agent and editing models**: the same env provider also feeds the agent and editing models. `ReconcileModelIDs` in `kernel/conf/ai.go` points them at it. The agent uses tool calls, which plugboard supports, so the agent is expected to work through the same alias. Not run. Its timeouts and limits come from `SIYUAN_OPENAI_AGENT_TIMEOUT`, `SIYUAN_OPENAI_AGENT_STREAM_IDLE_TIMEOUT`, `SIYUAN_OPENAI_AGENT_CONFIRM_TIMEOUT`, `SIYUAN_OPENAI_AGENT_MAX_RETRIES`, `SIYUAN_OPENAI_AGENT_TEMPERATURE`, `SIYUAN_OPENAI_AGENT_MAX_COMPLETION_TOKENS` and `SIYUAN_OPENAI_AGENT_MAX_TOOL_CALL_ROUNDS`.
- **Decision model**: a separate default points at `https://api.typesafe.ai/v1/systemone`, an external service. It is disabled by default (`kernel/conf/ai.go`). Leave it disabled unless you want that service.
- **Q/A**: no embeddings needed. The chat sends completions only: `ChatGPT` in `kernel/model/ai.go:53-59` calls no embedding code, and the agent package (`kernel/agent`) has no embedding reference. The agent's fulltext search works without embeddings (`kernel/mcp/tools/search.go:64-65`).
- **Semantic search and embeddings**: only the `semantic` search action uses embeddings (`kernel/mcp/tools/search.go:50,66-67`, search dialog method 4 in `app/src/search/util.ts:119`). It needs `ai.embedding.enabled`, a key and `isEmbeddingEnabled` (`kernel/model/embedding.go:624-627`). SiYuan's separate embedding setting reads `SIYUAN_OPENAI_EMBEDDING_API_KEY`, `SIYUAN_OPENAI_EMBEDDING_BASE_URL` and `SIYUAN_OPENAI_EMBEDDING_MODEL` (`kernel/conf/ai.go:508-518`), but the env path leaves `Enabled` false (`kernel/conf/ai.go:113-115`). Turn it on in the AI settings (`app/src/config/tabs/ai/aiTab.ts:258`) only after you point it at another provider. Plugboard serves no embeddings, so leave it off otherwise.
- **Image generation and speech**: not checked against plugboard, and the plugboard API has no image generation.

## Gotchas

- The env provider is the startup default. Whether a provider saved in the SiYuan settings replaces it was not checked. After the first start, open the AI settings and confirm the base URL and model.
- Set `SIYUAN_ACCESS_AUTH_CODE` (or `--accessAuthCode`). The README says anyone who can reach the port can open the data without it.
- Use a workspace path that matches `PUID` and `PGID`. See the README's "User Permissions" section.

## Sources

- [SiYuan `kernel/conf/ai.go` at fb3355f](https://github.com/siyuan-note/siyuan/blob/fb3355f07d22bff36f1d785999fd5ded6a90d468/kernel/conf/ai.go) (read 2026-10-12)
- Q/A and embeddings, line numbers at [7a7430d](https://github.com/siyuan-note/siyuan/tree/7a7430d) (read 2026-10-15): `kernel/model/ai.go`, `kernel/model/embedding.go`, `kernel/mcp/tools/search.go`, `kernel/conf/ai.go`, `app/src/search/util.ts`, `app/src/config/tabs/ai/aiTab.ts`
- [SiYuan README, Docker Deployment](https://github.com/siyuan-note/siyuan/blob/fb3355f07d22bff36f1d785999fd5ded6a90d468/README.md) (read 2026-10-12)
