# Examples

Copyable starting points, one directory per client. They are not part of the npm package (`files` in `package.json` ships only `index.ts`, `src/`, `README.md` and `LICENSE`).

The table below is generated from the run records by `bun .github/scripts/examples-index.ts` (CI runs it with `--check`). A scripted run is the committed, deterministic output of `run.ts` against a scripted plugboard. A live run is against a real provider and is never rewritten: its directory is named `<date>-<shortsha>` of the plugboard commit it ran against, and `-2` marks a second run on the same commit. A live directory with only a `REPORT.md` is a historical record copied from the old client kit. The client pages show the newest of each.

<!-- examples-index:start -->
| Example | Shows | Scripted | Newest live run |
| --- | --- | --- | --- |
| [aider/](aider/) | Aider (a terminal coding tool) through plugboard's OpenAI-compatible endpoint. A runner checks one message on three models | pass | [`2026-10-12-a67e176`](aider/runs/live/2026-10-12-a67e176/), historical record |
| [anythingllm/](anythingllm/) | AnythingLLM in Docker with the Generic OpenAI provider's env vars | not run | not run |
| [async-openai/](async-openai/) | async-openai (Rust) with a text call, a stream and one tool round trip. Run with `cargo run`; passes against plugboard | not run | not run |
| [autogen/](autogen/) | AutoGen (autogen 0.14.1, the classic `config_list` API) with a text call, a stream and a two-agent tool round. A PEP 723 script, run with `uv run`; passes on the OpenAI route, Anthropic route not run | not run | not run |
| [claude-code/](claude-code/) | Claude Code through `ANTHROPIC_BASE_URL`: shell exports and a `settings.json` `env` block | not run | not run |
| [codex-cli/](codex-cli/) | Codex CLI through a custom `responses` provider: a `config.toml` | not run | not run |
| [continue/](continue/) | Continue `config.yaml` with one plugboard model on Chat Completions and one on Responses | not run | not run |
| [crewai/](crewai/) | CrewAI with a text call, a stream and a crew task that calls one tool. A PEP 723 script, run with `uv run`; passes against plugboard | not run | not run |
| [curl/](curl/) | One request per API in plain shell: chat, responses, Anthropic Messages, Gemini, legacy completions and models | pass | [`2026-10-12-a38860b-2`](curl/runs/live/2026-10-12-a38860b-2/), fail |
| [dspy/](dspy/) | DSPy (through its LiteLLM route, `openai/` prefix): a Predict and a ChainOfThought on one question, and a typed output | pass | [`2026-10-12-a67e176`](dspy/runs/live/2026-10-12-a67e176/), historical record |
| [gemini-cli/](gemini-cli/) | The Gemini CLI, headless (`gemini -p`), with an API key and a base URL from the environment and no login: a chat and a stream. Its built-in tools make the other scenarios not applicable | pass | [`2026-10-16-987338b`](gemini-cli/runs/live/2026-10-16-987338b/), pass |
| [gemini-js/](gemini-js/) | The Google GenAI JS SDK (`@google/genai`) on plugboard's Gemini route: S1 to S7 and the error paths in TypeScript. A `#variant` id goes as `%23` | pass | [`2026-10-16-987338b`](gemini-js/runs/live/2026-10-16-987338b/), pass |
| [gemini-python/](gemini-python/) | The Google GenAI Python SDK (`google-genai`) on plugboard's Gemini route: S1 to S7 and the error paths. A `uv run` project with exact pins | partial | [`2026-10-16-987338b`](gemini-python/runs/live/2026-10-16-987338b/), partial |
| [go-openai/](go-openai/) | go-openai (Go) with a text call, a stream and one tool round trip. Run with `go run .`; passes against plugboard | pass | not run |
| [haystack/](haystack/) | Haystack `OpenAIChatGenerator` in a two-component pipeline, with streaming and a tool round trip. A PEP 723 script | not run | not run |
| [instructor/](instructor/) | Instructor extracting a validated Pydantic object, in TOOLS mode, JSON_SCHEMA mode and as a partial stream | pass | [`2026-10-12-a67e176`](instructor/runs/live/2026-10-12-a67e176/), historical record |
| [jan/](jan/) | Jan Agent: a `jan config set` script for the OpenAI-compatible route, and a per-project `agent.toml.example` | not run | not run |
| [kilo-code/](kilo-code/) | Kilo Code CLI provider block for plugboard's Chat Completions route | not run | not run |
| [langchain-google-genai/](langchain-google-genai/) | LangChain's `ChatGoogleGenerativeAI` (`langchain-google-genai`) on the Gemini route: chat, tools, streaming, images, structured output and the error paths | partial | [`2026-10-16-987338b`](langchain-google-genai/runs/live/2026-10-16-987338b/), partial |
| [langchain-js/](langchain-js/) | LangChain JS (`@langchain/openai`): the same scenarios, with a `chat` and an `auto` variant | partial | [`2026-10-13-c97ac66-2`](langchain-js/runs/live/2026-10-13-c97ac66-2/), partial |
| [langchain-python/](langchain-python/) | LangChain (`langchain-openai`'s `ChatOpenAI`): chat, tools, streaming, images, structured output, models and the error paths | pass | [`2026-10-13-c97ac66`](langchain-python/runs/live/2026-10-13-c97ac66/), pass |
| [langfuse/](langfuse/) | Langfuse's OpenAI wrapper (`from langfuse.openai import OpenAI`) with a text call, a stream and one tool round trip. A PEP 723 script, run with `uv run`; passes against plugboard with tracing off | pass | not run |
| [librechat/](librechat/) | LibreChat custom endpoints for plugboard, OpenAI and Anthropic shapes: `librechat.yaml`, a compose override and `.env` | not run | not run |
| [litellm-client/](litellm-client/) | LiteLLM's `completion()` with the `openai/` prefix: a completion, a stream, a tool round trip and structured output | pass | [`2026-10-12-a67e176`](litellm-client/runs/live/2026-10-12-a67e176/), historical record |
| [llamaindex/](llamaindex/) | LlamaIndex `OpenAILike` against plugboard: text, stream and a tool round trip. A PEP 723 script | not run | not run |
| [lobechat/](lobechat/) | LobeChat in Docker: `OPENAI_PROXY_URL` and the model list, in a compose file and `.env.example` | not run | not run |
| [mastra/](mastra/) | Mastra agent with one tool, using the `plugboard/fast` model object. Run with bun after `npm i @mastra/core zod` | not run | not run |
| [n8n/](n8n/) | n8n in Docker, driven headless through webhooks: S1 to S7; workflows in `workflows/` | pass | [`2026-10-13-b92fb6f`](n8n/runs/live/2026-10-13-b92fb6f/), partial |
| [open-webui/](open-webui/) | Open WebUI in Docker, pointed at plugboard on the host, with the plugboard options it needs; driven over its HTTP API | pass | [`2026-10-13-0cf8030`](open-webui/runs/live/2026-10-13-0cf8030/), pass |
| [openai-agents/](openai-agents/) | The OpenAI Agents SDK on the Responses API and on Chat Completions: text, stream, tool and structured output. Run with `uv run` | pass | [`2026-10-12-a67e176`](openai-agents/runs/live/2026-10-12-a67e176/), historical record |
| [openai-dotnet/](openai-dotnet/) | The official OpenAI .NET library with a text call, a stream and one tool round trip. Run with `dotnet run`; passes against plugboard | pass | not run |
| [openai-js/](openai-js/) | The OpenAI JS SDK: the same scenarios in TypeScript | pass | [`2026-10-13-50219b1`](openai-js/runs/live/2026-10-13-50219b1/), pass |
| [openai-python/](openai-python/) | The OpenAI Python SDK: chat, tools, streaming, images, structured output, models and the error paths | pass | [`2026-10-12-a38860b`](openai-python/runs/live/2026-10-12-a38860b/), pass |
| [promptfoo/](promptfoo/) | promptfoo config: `openai:chat:fast` with plugboard's base URL, a text check and a tool-call check | not run | not run |
| [pydantic-ai/](pydantic-ai/) | pydantic-ai (`OpenAIChatModel`, Chat Completions): chat, tools, streaming, images, structured output and the error paths | pass | [`2026-10-13-c97ac66-2`](pydantic-ai/runs/live/2026-10-13-c97ac66-2/), pass |
| [self-hosted/](self-hosted/) | Self-hosted apps configured by env or compose: Karakeep, Frigate (`config.yml`), paperless-gpt, paperless-ai (`.env` and compose), PR-Agent (`.env`), SiYuan (`.env` and compose). Page per app in docs/self-hosted | not run | not run |
| [semantic-kernel/](semantic-kernel/) | Semantic Kernel (Python) with a text call, a stream and a plugin call through automatic function calling. A PEP 723 script, run with `uv run`; passes against plugboard | not run | not run |
| [sillytavern/](sillytavern/) | SillyTavern in Docker; the plugboard endpoint and key are set in its UI | not run | not run |
| [smolagents/](smolagents/) | smolagents `OpenAIModel` with text, streaming and a `ToolCallingAgent`. A PEP 723 script (needs `smolagents[openai]`) | partial | not run |
| [tool-bot/](tool-bot/) | The tool-call round trip: plugboard returns `tool_calls`, your code runs the tool and sends the result back. Bun and the `openai` SDK, about 50 lines | pass | [`2026-10-13-50219b1`](tool-bot/runs/live/2026-10-13-50219b1/), partial |
| [vercel-ai-google/](vercel-ai-google/) | The Vercel AI SDK's Google provider (`@ai-sdk/google`) on the Gemini route: chat, tools, streaming, images, structured output and the errors. A model id with a `/` is sent as `%2F` | pass | [`2026-10-16-987338b`](vercel-ai-google/runs/live/2026-10-16-987338b/), pass |
| [vercel-ai-sdk/](vercel-ai-sdk/) | The Vercel AI SDK (`ai` 7) through its three ways in: `createOpenAICompatible`, `openai.chat(id)` and `openai(id)` on `/v1/responses`. Chat, tools, streaming, structured output, images, models and errors | pass | [`2026-10-13-c97ac66`](vercel-ai-sdk/runs/live/2026-10-13-c97ac66/), pass |
| [zed/](zed/) | Zed `settings.json` for an OpenAI-compatible and an Anthropic-compatible provider | not run | not run |
<!-- examples-index:end -->

Rerun the scripted check for one example, or for all of them:

```sh
bun examples/_harness/run.ts langchain-python --target scripted
bun examples/_harness/run.ts all --target scripted
git diff --exit-code examples/
```

`run.ts` starts a scripted plugboard and a capture proxy, then runs the example's runner. Set `PLUGBOARD_BASE_URL` and `PLUGBOARD_KEY` only for a live run against a server you run. See [_harness/README.md](_harness/README.md) for the targets and how to add an example.

Examples with a harness run are checked in CI; the rest are copyable starting points, with the setup in their own README. Docker examples (n8n, open-webui) run with `--docker` and are not run in CI.

## Historical records

A `runs/live/<date>-<sha>/REPORT.md` is a copy of a dated record and is never rewritten. Three things in those copies are out of date, and none is a fact about the run:

- Records dated before 2026-10-13 name scripts under `compat/` that were removed in `5412c51` and when `compat/` was deleted (for example `compat/docker/open-webui.sh`, `compat/docker/n8n/run.sh`, `compat/tools/logproxy.py`, `compat/py/openai_py.py`). `git show 3d3735c:<path>` restores any of them.
- The header of the seven 2026-10-11 copies (openai-python, openai-js, vercel-ai-sdk, pydantic-ai, langchain-python, n8n, open-webui) links `release-candidate.md` by a relative path. It now lives at `examples/_release/release-candidate.md`.
- `langchain-python`'s 2026-10-11 record names `compat/py/langchain_py.py` and `compat/js/langchain_js.ts`; those scripts are in `git show 3d3735c:<path>`.

A new record for a client goes in `runs/live/<date>-<sha>/REPORT.md`, written from [`_release/_template.md`](_release/_template.md). Rules for records and superseded notes are in [_harness/README.md](_harness/README.md#record-keeping).

## Self-hosted apps

The examples in [self-hosted/](self-hosted/) are for apps that already run in Docker or take a YAML file. Each has a README, and the app's page in [docs/self-hosted](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/self-hosted.md) lists what works through plugboard. They are docs-verified, not run.

- [Karakeep](self-hosted/karakeep/README.md): `.env.example` and a compose override for the upstream `docker-compose.yml`
- [Frigate](self-hosted/frigate/README.md): a `genai` provider in `config.yml`
- [paperless-gpt](self-hosted/paperless-gpt/README.md): a compose service and `.env.example`
- [paperless-ai](self-hosted/paperless-ai/README.md): a compose file and `.env.example` for its custom provider
- [PR-Agent](self-hosted/pr-agent/README.md): `.env.example` for the OpenAI-like provider, and the model in `configuration.toml`
- [SiYuan](self-hosted/siyuan/README.md): a compose file and `.env.example` for its OpenAI provider environment variables

## Setup for the other examples

Setup for each client is in the [client guides](https://github.com/jjjermiah/opencode-plugboard/tree/main/docs/clients). The [configuration reference](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/configuration.md) covers every option. The [curl example](curl/README.md) covers the chat, responses, messages, Gemini, completions and models routes. The usage route (`/plugboard/usage`) is not in it yet.

### LlamaIndex

```sh
cd examples/llamaindex
PLUGBOARD_KEY=<your key> uv run example.py
```

`PLUGBOARD_URL` (default `http://127.0.0.1:4010/v1`) overrides the endpoint. The script uses `OpenAILike`, because the `OpenAI` class rejects model ids it does not know.

### Tool bot

```sh
cd examples/tool-bot
bun install
PLUGBOARD_KEY=<your key> bun index.ts "What is the weather in Paris?"
```

`PLUGBOARD_URL` (default `http://127.0.0.1:4010/v1`) and `PLUGBOARD_MODEL` (default `fast`) override the endpoint and model.

### Aider

Copy `.env.example` to `.env` and fill in the key, then run from the repo you want to edit:

```sh
cd examples/aider && cp .env.example .env
aider --model openai/fast
```

See [the Aider client page](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/clients/aider.md) for what was tested.

### Python examples with a runner

The DSPy, Instructor, LiteLLM and OpenAI Agents examples have a `pyproject.toml` with exact pins and a `uv.lock`. Their runner is `run.py`, and `uv run --frozen run.py` runs it through the harness. `bun examples/_harness/run.ts <example> --target scripted` is the same run, with the capture proxy and the committed output.
