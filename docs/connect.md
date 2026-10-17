# Connect your app

Every client needs the same three things: where plugboard is, a plugboard key, and a model name. The only choice is which API your app speaks.

| Setting | Value |
| --- | --- |
| Address | `http://127.0.0.1:4010` (change it if you changed `listen`) |
| Key | a key from the `keys` option. Not a provider key |
| Model | an alias from `aliases`, or `provider/model[#variant]` from `models` |

`GET /v1/models` lists the model names this key may use.

## Choose by API

| The app speaks | Base URL | Key goes in | Read |
| --- | --- | --- | --- |
| OpenAI (Chat Completions, most apps) | `http://127.0.0.1:4010/v1` | `Authorization: Bearer <key>` | [Chat Completions](chat-completions.md) |
| OpenAI Responses | `http://127.0.0.1:4010/v1` | `Authorization: Bearer <key>` | [Responses](responses.md) |
| Anthropic | `http://127.0.0.1:4010` (the SDK adds `/v1/messages`) | `x-api-key` or `Authorization: Bearer` | [Messages](messages.md) |
| Gemini | `http://127.0.0.1:4010` (the SDK adds `/v1beta`) | `x-goog-api-key` | [Gemini](gemini.md) |
| Old `completions` scripts | `http://127.0.0.1:4010/v1` | `Authorization: Bearer <key>` | [Completions](completions.md) |

If an app only asks for "an OpenAI-compatible URL", use the first row. See [Any OpenAI-compatible app](clients/any-app.md) for the settings every such app shares and the gotchas.

## Choose by client

Each client page has the config, a chat, a tool call, structured output and what was found in testing. The [clients overview](clients/index.md) lists all of them with their results.

| You use | Start here |
| --- | --- |
| An SDK in your language | [SDKs](clients/index.md#sdks): [OpenAI Python](clients/openai-python.md), [OpenAI JS](clients/openai-js.md), [Anthropic Python](clients/anthropic-python.md), [Anthropic JS](clients/anthropic-js.md), [Google GenAI JS](clients/google-genai-js.md), [Go](clients/go-openai.md), [.NET](clients/openai-dotnet.md), [Rust](clients/async-openai.md) |
| An agent framework | [Agent frameworks](clients/index.md#agent-frameworks): [LangChain](clients/langchain-python.md), [LlamaIndex](clients/llamaindex.md), [CrewAI](clients/crewai.md), [pydantic-ai](clients/pydantic-ai.md), [Vercel AI SDK](clients/vercel-ai-sdk.md) |
| A chat app | [Chat apps](clients/index.md#chat-apps-and-automation): [Open WebUI](clients/open-webui.md), [LibreChat](clients/librechat.md), [n8n](clients/n8n.md), [Chatbox](clients/chatbox.md) |
| A coding tool | [Coding tools](clients/index.md#coding-tools): [Claude Code](clients/claude-code.md), [Codex CLI](clients/codex-cli.md), [OpenCode](clients/opencode.md), [Cline](clients/cline.md), [Aider](clients/aider.md) |
| An evaluation or tracing tool | [Evaluation and observability](clients/index.md#evaluation-and-observability): [promptfoo](clients/promptfoo.md), [lm-evaluation-harness](clients/lm-eval.md), [Langfuse](clients/langfuse.md) |
| A self-hosted app such as Karakeep or Mealie | [Self-hosted apps](self-hosted.md) |
| Something else | [Any OpenAI-compatible app](clients/any-app.md) |

## The app runs somewhere else

`127.0.0.1` only reaches plugboard from the OpenCode host. From another machine or a container you must bind a reachable address, set keys, and limit who can connect. See [Serving other machines](guides/serving-other-machines.md).

## Next

- [Apps and keys](guides/apps-and-keys.md): give each tool its own key.
- [Models, aliases and fallbacks](guides/models-and-aliases.md): choose what the app may call.
