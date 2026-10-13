# Examples

Copyable starting points. They are not part of the npm package (`files` in `package.json` ships only `index.ts`, `src/`, `README.md` and `LICENSE`), and they are not in `compat/`, which holds the client test harnesses.

| Example | Shows |
| --- | --- |
| [open-webui/](open-webui/README.md) | Open WebUI in Docker, pointed at plugboard on the host, with the plugboard options it needs |
| [claude-code/](claude-code/README.md) | Claude Code through `ANTHROPIC_BASE_URL`: shell exports and a `settings.json` `env` block |
| [codex-cli/](codex-cli/README.md) | Codex CLI through a custom `responses` provider: a `config.toml` |
| [continue/](continue/README.md) | Continue `config.yaml` with one plugboard model on Chat Completions and one on Responses |
| [kilo-code/](kilo-code/README.md) | Kilo Code CLI provider block for plugboard's Chat Completions route |
| [librechat/](librechat/README.md) | LibreChat custom endpoints for plugboard, OpenAI and Anthropic shapes: `librechat.yaml`, a compose override and `.env` |
| [lobechat/](lobechat/docker-compose.yml) | LobeChat in Docker: `OPENAI_PROXY_URL` and the model list, in a compose file and `.env.example` |
| [jan/](jan/setup.sh) | Jan Agent: a `jan config set` script for the OpenAI-compatible route, and a per-project `agent.toml.example` |
| [anythingllm/](anythingllm/docker-compose.yml) | AnythingLLM in Docker with the Generic OpenAI provider's env vars |
| [sillytavern/](sillytavern/docker-compose.yml) | SillyTavern in Docker; the plugboard endpoint and key are set in its UI |
| [llamaindex/](llamaindex/example.py) | LlamaIndex `OpenAILike` against plugboard: text, stream and a tool round trip. A PEP 723 script |
| [haystack/](haystack/example.py) | Haystack `OpenAIChatGenerator` in a two-component pipeline, with streaming and a tool round trip. A PEP 723 script |
| [mastra/](mastra/agent.ts) | Mastra agent with one tool, using the `plugboard/fast` model object. Run with bun after `npm i @mastra/core zod` |
| [smolagents/](smolagents/example.py) | smolagents `OpenAIModel` with text, streaming and a `ToolCallingAgent`. A PEP 723 script (needs `smolagents[openai]`) |
| [promptfoo/](promptfoo/promptfooconfig.yaml) | promptfoo config: `openai:chat:fast` with plugboard's base URL, a text check and a tool-call check |
| [zed/](zed/README.md) | Zed `settings.json` for an OpenAI-compatible and an Anthropic-compatible provider |
| [tool-bot/](tool-bot/index.ts) | The tool-call round trip: plugboard returns `tool_calls`, your code runs the tool and sends the result back. Bun and the `openai` SDK, about 50 lines |
| [openai-agents/](openai-agents/agent.py) | The OpenAI Agents SDK (Python) with one tool, on the Responses API or Chat Completions. A PEP 723 script, run with `uv run` |
| [go-openai/](go-openai/main.go) | go-openai (Go) with a text call, a stream and one tool round trip. Run with `go run .`; passes against plugboard |
| [openai-dotnet/](openai-dotnet/Program.cs) | The official OpenAI .NET library with a text call, a stream and one tool round trip. Run with `dotnet run`; passes against plugboard |
| [litellm-client/](litellm-client/example.py) | LiteLLM's `completion()` with the `openai/` prefix, one call and one stream. A PEP 723 script |
| [instructor/](instructor/example.py) | Instructor extracting a validated Pydantic object, with `mode=TOOLS`. A PEP 723 script |
| [dspy/](dspy/example.py) | A DSPy `ChainOfThought` program with a typed pydantic output, through `dspy.LM`. A PEP 723 script |
| [aider/](aider/.aider.conf.yml) | Aider (a terminal coding tool) pointed at plugboard: `.aider.conf.yml` and `.env.example` |
| [self-hosted/](self-hosted/) | Self-hosted apps configured by env or compose: Karakeep, Frigate (`config.yml`), paperless-gpt. Page per app in [docs/self-hosted](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/self-hosted.md) |
| [curl](#curl) | One request per API: chat, responses, messages, Gemini, models and usage |

Setup for each client is in the [client guides](https://github.com/jjjermiah/opencode-plugboard/tree/main/docs/clients). The [configuration reference](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/configuration.md) covers every option.

## Self-hosted apps

The examples in [self-hosted/](self-hosted/) are for apps that already run in Docker or take a YAML file. Each has a README, and the app's page in [docs/self-hosted](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/self-hosted.md) lists what works through plugboard. They are docs-verified, not run.

- [Karakeep](self-hosted/karakeep/README.md): `.env.example` and a compose override for the upstream `docker-compose.yml`
- [Frigate](self-hosted/frigate/README.md): a `genai` provider in `config.yml`
- [paperless-gpt](self-hosted/paperless-gpt/README.md): a compose service and `.env.example`

## LlamaIndex

```sh
cd examples/llamaindex
PLUGBOARD_KEY=<your key> uv run example.py
```

`PLUGBOARD_URL` (default `http://127.0.0.1:4010/v1`) overrides the endpoint. The script uses `OpenAILike`, because the `OpenAI` class rejects model ids it does not know.

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

## DSPy

```sh
cd examples/dspy
PLUGBOARD_KEY=<your key> uv run example.py
```

`PLUGBOARD_URL` defaults to `http://127.0.0.1:4010`.

## Aider

Copy `.env.example` to `.env` and fill in the key, then run from the repo you want to edit:

```sh
cd examples/aider && cp .env.example .env
aider --model openai/fast
```

See [the Aider client page](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/clients/aider.md) for what was tested.

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

Usage (`/plugboard/usage`) needs the admin key from the `adminKey` option, not an app key. Dates are UTC and inclusive:

```sh
curl -s "$PLUGBOARD_URL/plugboard/usage?from=2026-10-01&to=2026-10-11" -H "Authorization: Bearer $PLUGBOARD_ADMIN_KEY"
```

Replace `fast` with any id from `/v1/models`, or with an alias you defined.
