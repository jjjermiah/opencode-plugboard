# Clients

Every client needs a base URL, a plugboard key and a model name ([Connect your app](../connect.md)). Each page below has the settings and working code or config for one client, and the limits to know about. Runnable versions of the code are in [`examples/`](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples).

Not listed? Any app with an "OpenAI-compatible" setting works: see [Any OpenAI-compatible app](any-app.md).

## SDKs

| Language | OpenAI API | Anthropic API | Gemini API |
| --- | --- | --- | --- |
| Python | [OpenAI Python](openai-python.md) | [Anthropic Python](anthropic-python.md) | [Google GenAI Python](google-genai-python.md) |
| TypeScript | [OpenAI JS](openai-js.md), [Vercel AI SDK](vercel-ai-sdk.md) | [Anthropic TypeScript](anthropic-js.md), [Vercel AI SDK (Anthropic)](vercel-ai-sdk-anthropic.md) | [Google GenAI JS](google-genai-js.md), [Vercel AI SDK (Google)](vercel-ai-google.md) |
| Go | [go-openai](go-openai.md) | | |
| .NET | [openai-dotnet](openai-dotnet.md) | | |
| Rust | [async-openai](async-openai.md) | | |

## Agent frameworks

- **Python:** [LangChain](langchain-python.md) ([Anthropic](langchain-anthropic-python.md), [Google](langchain-google-genai.md)), [pydantic-ai](pydantic-ai.md) ([Anthropic](pydantic-ai-anthropic.md)), [OpenAI Agents SDK](openai-agents.md), [CrewAI](crewai.md), [AutoGen / AG2](autogen.md), [Semantic Kernel](semantic-kernel.md), [LlamaIndex](llamaindex.md), [Haystack](haystack.md), [smolagents](smolagents.md), [Instructor](instructor.md), [DSPy](dspy.md), [LiteLLM as a client](litellm-client.md)
- **TypeScript:** [LangChain JS](langchain-js.md) ([Anthropic](langchain-anthropic-js.md)), [OpenAI Agents SDK JS](openai-agents-js.md), [Mastra](mastra.md)
- **Java:** [Spring AI](spring-ai.md), [LangChain4j](langchain4j.md)

## Chat apps and automation

[Open WebUI](open-webui.md), [LibreChat](librechat.md), [LobeChat](lobechat.md), [Chatbox](chatbox.md), [Jan](jan.md), [AnythingLLM](anythingllm.md), [SillyTavern](sillytavern.md), [n8n](n8n.md), [Dify](dify.md), [Home Assistant (Extended OpenAI)](home-assistant-extended-openai.md)

## Coding tools

[Claude Code](claude-code.md), [OpenCode](opencode.md), [Codex CLI](codex-cli.md), [Gemini CLI](gemini-cli.md), [Aider](aider.md), [Cline](cline.md), [Roo Code](roo-code.md), [Kilo Code](kilo-code.md), [Continue](continue.md), [Zed](zed.md)

## Evaluation and observability

[promptfoo](promptfoo.md), [lm-evaluation-harness](lm-eval.md), [Langfuse](langfuse.md)

## Self-hosted apps

Karakeep, Mealie, paperless, Frigate and more: see [Self-hosted apps](../self-hosted.md).
