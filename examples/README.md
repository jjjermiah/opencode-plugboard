# Examples

Copyable starting points. They are not part of the npm package (`files` in `package.json` ships only `index.ts`, `src/`, `README.md` and `LICENSE`), and they are not in `compat/`, which holds the client test harnesses.

| Example | Shows |
| --- | --- |
| [open-webui/](open-webui/README.md) | Open WebUI in Docker, pointed at plugboard on the host, with the plugboard options it needs |
| [tool-bot/](tool-bot/index.ts) | The tool-call round trip: plugboard returns `tool_calls`, your code runs the tool and sends the result back. Bun and the `openai` SDK, about 50 lines |
| [openai-agents/](openai-agents/agent.py) | The OpenAI Agents SDK (Python) with one tool, on the Responses API or Chat Completions. A PEP 723 script, run with `uv run` |
| [litellm-client/](litellm-client/example.py) | LiteLLM's `completion()` with the `openai/` prefix, one call and one stream. A PEP 723 script |
| [instructor/](instructor/example.py) | Instructor extracting a validated Pydantic object, with `mode=TOOLS`. A PEP 723 script |
| [curl](#curl) | One request per API: chat, responses, messages, Gemini, models and usage |

Setup for each client is in the [client guides](https://github.com/jjjermiah/opencode-plugboard/tree/main/docs/clients). The [configuration reference](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/configuration.md) covers every option.

## Tool bot

```sh
cd examples/tool-bot
bun install
PLUGBOARD_KEY=<your key> bun index.ts "What is the weather in Paris?"
```

`PLUGBOARD_URL` (default `http://127.0.0.1:4010/v1`) and `PLUGBOARD_MODEL` (default `fast`) override the endpoint and model.

## OpenAI Agents SDK

```sh
cd examples/openai-agents
PLUGBOARD_KEY=<your key> uv run agent.py
```

`PLUGBOARD_URL` (default `http://127.0.0.1:4010`) and `PLUGBOARD_API=chat_completions` change the endpoint and the API. `uv` reads the dependency pin from the script header, so there is no install step.

## LiteLLM as a client

```sh
cd examples/litellm-client
PLUGBOARD_KEY=<your key> uv run example.py
```

`PLUGBOARD_URL` defaults to `http://127.0.0.1:4010`. The `openai/` prefix is what routes the call to Chat Completions.

## Instructor

```sh
cd examples/instructor
PLUGBOARD_KEY=<your key> uv run example.py
```

`PLUGBOARD_URL` defaults to `http://127.0.0.1:4010`.

## curl

Set the base URL and a key, then run any line. Each one is a single request, so you can paste it into a shell to see what plugboard returns.

```sh
export PLUGBOARD_URL=${PLUGBOARD_URL:-http://127.0.0.1:4010}
export PLUGBOARD_KEY=<your app key>
```

Models your key may use (`/v1/models` lists only what the app's policy allows):

```sh
curl -s "$PLUGBOARD_URL/v1/models" -H "Authorization: Bearer $PLUGBOARD_KEY"
```

Chat Completions (`/v1/chat/completions`):

```sh
curl -s "$PLUGBOARD_URL/v1/chat/completions" -H "Authorization: Bearer $PLUGBOARD_KEY" -H "Content-Type: application/json" -d '{"model": "fast", "messages": [{"role": "user", "content": "reply with exactly: pong"}]}'
```

Responses (`/v1/responses`):

```sh
curl -s "$PLUGBOARD_URL/v1/responses" -H "Authorization: Bearer $PLUGBOARD_KEY" -H "Content-Type: application/json" -d '{"model": "fast", "input": "reply with exactly: pong"}'
```

Anthropic Messages (`/v1/messages`), with the key in `x-api-key`:

```sh
curl -s "$PLUGBOARD_URL/v1/messages" -H "x-api-key: $PLUGBOARD_KEY" -H "anthropic-version: 2023-06-01" -H "Content-Type: application/json" -d '{"model": "fast", "max_tokens": 64, "messages": [{"role": "user", "content": "reply with exactly: pong"}]}'
```

Gemini `generateContent`, with the key in `x-goog-api-key`:

```sh
curl -s "$PLUGBOARD_URL/v1beta/models/fast:generateContent" -H "x-goog-api-key: $PLUGBOARD_KEY" -H "Content-Type: application/json" -d '{"contents": [{"parts": [{"text": "reply with exactly: pong"}]}]}'
```

Usage (`/v1/usage`) needs the admin key from the `adminKey` option, not an app key. Dates are UTC and inclusive:

```sh
curl -s "$PLUGBOARD_URL/v1/usage?from=2026-10-01&to=2026-10-11" -H "Authorization: Bearer $PLUGBOARD_ADMIN_KEY"
```

Replace `fast` with any id from `/v1/models`, or with an alias you defined.
