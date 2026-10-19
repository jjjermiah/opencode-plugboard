# Dify

Dify's **OpenAI-API-compatible** model provider, in Chat completion mode.

## Plugboard options

Give Dify its own key. If Dify runs in Docker, plugboard must bind a reachable address ([Serving other machines](../guides/serving-other-machines.md)):

```jsonc plugboard-options
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "dify": "{env:PLUGBOARD_KEY_DIFY}" },
    "models": ["anthropic/claude-sonnet-4-6"],
    "aliases": { "fast": "anthropic/claude-sonnet-4-6" },
    "apps": { "dify": { "models": ["fast"] } }
  }
}
```

## Connect

**Integrations → Model Provider**: install **OpenAI-API-compatible**, then **Add Model** with type **LLM**:

| Field | Value |
| --- | --- |
| Model Name | `fast` (or what you want Dify to show) |
| model name for API endpoint | `fast`, a model the `dify` app may use |
| API Key | the `dify` key |
| API Base URL | `http://host.docker.internal:4010/v1` (with `/v1`) |
| Completion mode | Chat |
| Model context size, Upper bound for max tokens | the model's real values (the defaults are 4096) |
| Function Call Type | **Tool Call**, so agents and tool nodes can call tools |
| Vision Support | Support, for a model that takes images |
| Structured Output | Support only if you type the schema in the wrapper form (below) |

Leave the other fields at their defaults. Saving sends a short test request, so plugboard must be reachable from the Dify server.

## What works

Chat, streaming with usage, tool calls (Dify runs the tools), and images (Dify sends them as `data:` URLs).

## Structured output

With **Structured Output: Support**, type the schema as `{"name": "...", "schema": {...}, "strict": true}`. A bare schema (`{"type": "object", ...}`) answers 400 `response_format.json_schema.schema must be a JSON Schema object`.

## Limits

- Keep **Video**, **Audio** and **Document Support** off: the plugin sends them in shapes plugboard refuses (400 `invalid_image`). PDFs work as `file` parts.
- Add only LLM models. Plugboard has no embeddings, rerank or speech.
- A workflow with more than 64 tools gets 400 `too_many_tools`; raise `maxTools`.
- Dify Cloud can't reach a plugboard on your LAN; use a self-hosted Dify.
