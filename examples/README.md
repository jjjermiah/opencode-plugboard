# Examples

Copyable starting points, one directory per client. They are not part of the npm package (`files` in `package.json` ships only `index.ts`, `src/`, `README.md` and `LICENSE`).

The client examples with a harness run (the first block of the table) check themselves. `run.ts` drives each scenario against a scripted plugboard. Its output is committed under `runs/scripted/`, and a rerun must leave `git diff` clean. Their `runs/live/` directories hold the runs against a real provider. A live run directory is named `<date>-<shortsha>` of the plugboard commit it ran against, and is never rewritten. A directory with only a `REPORT.md` is a historical record.

Rerun the scripted check for one example, or for all of them:

```sh
bun examples/_harness/run.ts langchain-python --target scripted
bun examples/_harness/run.ts all --target scripted
git diff --exit-code examples/
```

Set `PLUGBOARD_BASE_URL` and `PLUGBOARD_KEY` to run an example against a server you run. The harness does this for you when it runs an example. See [_harness/README.md](_harness/README.md) for the targets and how to add an example.

## Status

Status is the verdict of the newest run in each directory (`pass`, `partial`, `fail`). "Not run" means no run is committed for the example yet. A run's verdict is per target; the table shows the scripted run and the newest live run.

| Example | Shows | Scripted | Newest live run |
| --- | --- | --- | --- |
| [openai-python/](openai-python/README.md) | The OpenAI Python SDK: chat, tools, streaming, images, structured output, models and the error paths | pass | `2026-10-12-a38860b`, pass |
| [openai-js/](openai-js/README.md) | The OpenAI JS SDK: the same scenarios in TypeScript | pass | `2026-10-13-50219b1`, pass |
| [vercel-ai-sdk/](vercel-ai-sdk/README.md) | The Vercel AI SDK (`ai` 7) through its three ways in: `createOpenAICompatible`, `openai.chat(id)` and `openai(id)` on `/v1/responses` | pass | `2026-10-13-c97ac66`, pass |
| [langchain-python/](langchain-python/README.md) | LangChain (`langchain-openai`'s `ChatOpenAI`): chat, tools, streaming, images, structured output, models and the error paths | pass | `2026-10-13-c97ac66`, pass |
| [langchain-js/](langchain-js/README.md) | LangChain JS (`@langchain/openai`): the same scenarios, with a `chat` and an `auto` variant | partial | `2026-10-13-c97ac66-2`, partial (the Responses route for `gpt-5.6` ids) |
| [pydantic-ai/](pydantic-ai/README.md) | pydantic-ai (`OpenAIChatModel`, Chat Completions): chat, tools, streaming, images, structured output and the error paths | pass | `2026-10-13-c97ac66-2`, pass |
| [n8n/](n8n/README.md) | n8n in Docker, driven headless through webhooks: S1 to S7; workflows in `workflows/` | pass | `2026-10-13-b92fb6f`, partial |
| [open-webui/](open-webui/README.md) | Open WebUI in Docker, pointed at plugboard on the host, with the plugboard options it needs; driven over its HTTP API | pass | `2026-10-13-0cf8030`, pass |
| [tool-bot/](tool-bot/index.ts) | The tool-call round trip: plugboard returns `tool_calls`, your code runs the tool and sends the result back. Bun and the `openai` SDK, about 50 lines | pass | `2026-10-13-50219b1`, partial |
| [curl/](curl/README.md) | One request per API in plain shell: chat, responses, Anthropic Messages, Gemini, legacy completions and models | pass | `2026-10-12-a38860b-2`, fail (see its report) |

The clients below are examples without a harness run yet. Their status is "not run": the example's README says what was tested, and any earlier record of a run is in its `runs/` directory when one was migrated.

| Example | Shows | Status |
| --- | --- | --- |
| [claude-code/](claude-code/README.md) | Claude Code through `ANTHROPIC_BASE_URL`: shell exports and a `settings.json` `env` block | not run |
| [codex-cli/](codex-cli/README.md) | Codex CLI through a custom `responses` provider: a `config.toml` | not run |
| [continue/](continue/README.md) | Continue `config.yaml` with one plugboard model on Chat Completions and one on Responses | not run |
| [kilo-code/](kilo-code/README.md) | Kilo Code CLI provider block for plugboard's Chat Completions route | not run |
| [librechat/](librechat/README.md) | LibreChat custom endpoints for plugboard, OpenAI and Anthropic shapes: `librechat.yaml`, a compose override and `.env` | not run |
| [lobechat/](lobechat/docker-compose.yml) | LobeChat in Docker: `OPENAI_PROXY_URL` and the model list, in a compose file and `.env.example` | not run |
| [jan/](jan/setup.sh) | Jan Agent: a `jan config set` script for the OpenAI-compatible route, and a per-project `agent.toml.example` | not run |
| [anythingllm/](anythingllm/docker-compose.yml) | AnythingLLM in Docker with the Generic OpenAI provider's env vars | not run |
| [sillytavern/](sillytavern/docker-compose.yml) | SillyTavern in Docker; the plugboard endpoint and key are set in its UI | not run |
| [llamaindex/](llamaindex/example.py) | LlamaIndex `OpenAILike` against plugboard: text, stream and a tool round trip. A PEP 723 script | not run |
| [haystack/](haystack/example.py) | Haystack `OpenAIChatGenerator` in a two-component pipeline, with streaming and a tool round trip. A PEP 723 script | not run |
| [mastra/](mastra/agent.ts) | Mastra agent with one tool, using the `plugboard/fast` model object. Run with bun after `npm i @mastra/core zod` | not run |
| [smolagents/](smolagents/example.py) | smolagents `OpenAIModel` with text, streaming and a `ToolCallingAgent`. A PEP 723 script (needs `smolagents[openai]`) | not run |
| [langfuse/](langfuse/example.py) | Langfuse's OpenAI wrapper (`from langfuse.openai import OpenAI`) with a text call, a stream and one tool round trip. A PEP 723 script, run with `uv run`; passes against plugboard with tracing off | not run |
| [promptfoo/](promptfoo/promptfooconfig.yaml) | promptfoo config: `openai:chat:fast` with plugboard's base URL, a text check and a tool-call check | not run |
| [zed/](zed/README.md) | Zed `settings.json` for an OpenAI-compatible and an Anthropic-compatible provider | not run |
| [openai-agents/](openai-agents/agent.py) | The OpenAI Agents SDK (Python) with one tool, on the Responses API or Chat Completions. A PEP 723 script, run with `uv run` | not run |
| [go-openai/](go-openai/main.go) | go-openai (Go) with a text call, a stream and one tool round trip. Run with `go run .`; passes against plugboard | not run |
| [openai-dotnet/](openai-dotnet/Program.cs) | The official OpenAI .NET library with a text call, a stream and one tool round trip. Run with `dotnet run`; passes against plugboard | not run |
| [async-openai/](async-openai/src/main.rs) | async-openai (Rust) with a text call, a stream and one tool round trip. Run with `cargo run`; passes against plugboard | not run |
| [crewai/](crewai/crew.py) | CrewAI with a text call, a stream and a crew task that calls one tool. A PEP 723 script, run with `uv run`; passes against plugboard | not run |
| [autogen/](autogen/chat.py) | AutoGen (autogen 0.14.1, the classic `config_list` API) with a text call, a stream and a two-agent tool round. A PEP 723 script, run with `uv run`; passes on the OpenAI route, Anthropic route not run | not run |
| [semantic-kernel/](semantic-kernel/chat.py) | Semantic Kernel (Python) with a text call, a stream and a plugin call through automatic function calling. A PEP 723 script, run with `uv run`; passes against plugboard | not run |
| [litellm-client/](litellm-client/example.py) | LiteLLM's `completion()` with the `openai/` prefix, one call and one stream. A PEP 723 script | not run |
| [instructor/](instructor/example.py) | Instructor extracting a validated Pydantic object, with `mode=TOOLS`. A PEP 723 script | not run |
| [dspy/](dspy/example.py) | A DSPy `ChainOfThought` program with a typed pydantic output, through `dspy.LM`. A PEP 723 script | not run |
| [aider/](aider/.aider.conf.yml) | Aider (a terminal coding tool) pointed at plugboard: `.aider.conf.yml` and `.env.example` | not run |
| [self-hosted/](self-hosted/) | Self-hosted apps configured by env or compose: Karakeep, Frigate (`config.yml`), paperless-gpt, paperless-ai (`.env` and compose), PR-Agent (`.env`), SiYuan (`.env` and compose). Page per app in [docs/self-hosted](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/self-hosted.md) | docs-verified, not run |

Setup for each client is in the [client guides](https://github.com/jjjermiah/opencode-plugboard/tree/main/docs/clients). The [configuration reference](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/configuration.md) covers every option. The [curl example](curl/README.md) covers the chat, responses, messages, Gemini, completions and models routes. The usage route (`/plugboard/usage`) is not in it yet.

## Self-hosted apps

The examples in [self-hosted/](self-hosted/) are for apps that already run in Docker or take a YAML file. Each has a README, and the app's page in [docs/self-hosted](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/self-hosted.md) lists what works through plugboard. They are docs-verified, not run.

- [Karakeep](self-hosted/karakeep/README.md): `.env.example` and a compose override for the upstream `docker-compose.yml`
- [Frigate](self-hosted/frigate/README.md): a `genai` provider in `config.yml`
- [paperless-gpt](self-hosted/paperless-gpt/README.md): a compose service and `.env.example`
- [paperless-ai](self-hosted/paperless-ai/README.md): a compose file and `.env.example` for its custom provider
- [PR-Agent](self-hosted/pr-agent/README.md): `.env.example` for the OpenAI-like provider, and the model in `configuration.toml`
- [SiYuan](self-hosted/siyuan/README.md): a compose file and `.env.example` for its OpenAI provider environment variables

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

The [curl example](curl/README.md) has one script per API (chat, responses, Anthropic Messages, Gemini, legacy completions and models), each runnable on its own, and its scripted and live runs are in [curl/runs/](curl/runs/). The usage route (`/plugboard/usage`) needs the admin key, not an app key, and is not in the curl example yet.
