import { readFileSync } from "node:fs"
import { defineConfig } from "vitepress"

const repo = "https://github.com/jjjermiah/opencode-plugboard"

// The latest release. package.json on main is the last release: the release pull request bumps it and
// the tag is its merge commit. The theme shows it in a banner (theme/index.ts).
const latest: string = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version

// The site is built from docs/. The sidebar tells one story: get started, then one guide per task, then the
// clients and the reference. Page files keep their old paths, so old links still work.
export default defineConfig({
  title: "opencode-plugboard",
  description:
    "Use your ChatGPT, Claude, Copilot and OpenCode Go logins from any OpenAI, Anthropic or Gemini compatible app.",
  base: "/opencode-plugboard/",
  cleanUrls: true,
  lastUpdated: false,
  // Maintainer and test pages live in docs/ next to the code they describe, but are not part of the user site.
  srcExclude: [
    "architecture.md",
    "best-practices.md",
    "compatibility.md",
    "development.md",
    "examples.md",
    "live-matrix.md",
    "packaging.md",
    "red-team.md",
    "releasing.md",
    "review-bot.md",
    "security-reviews.md",
  ],
  vite: {
    define: { __PLUGBOARD_LATEST__: JSON.stringify(latest) },
    // `__PLUGBOARD_VERSION__` in a page, code blocks included, becomes the latest release, so install snippets never go stale.
    plugins: [
      {
        name: "plugboard-version",
        enforce: "pre",
        transform: (code: string, id: string) => (id.endsWith(".md") ? code.replaceAll("__PLUGBOARD_VERSION__", latest) : undefined),
      },
    ],
  },
  themeConfig: {
    nav: [
      { text: "Get started", link: "/install" },
      { text: "Guides", link: "/guides/apps-and-keys" },
      { text: "Clients", link: "/clients/" },
      {
        text: "Reference",
        items: [
          { text: "Configuration", link: "/configuration" },
          { text: "APIs", link: "/apis" },
          { text: "Response headers", link: "/headers" },
          { text: "Errors", link: "/errors" },
        ],
      },
      {
        text: "Community",
        items: [
          { text: "Discussions", link: `${repo}/discussions` },
          { text: "Issues", link: `${repo}/issues` },
          { text: "Contributing", link: `${repo}/blob/main/CONTRIBUTING.md` },
        ],
      },
      { text: "Changelog", link: `${repo}/blob/main/CHANGELOG.md` },
    ],
    sidebar: [
      {
        text: "Get started",
        items: [
          { text: "What is plugboard", link: "/" },
          { text: "Install and first request", link: "/install" },
          { text: "Connect your app", link: "/connect" },
        ],
      },
      {
        text: "Guides",
        items: [
          { text: "Apps and keys", link: "/guides/apps-and-keys" },
          { text: "Models, aliases and fallbacks", link: "/guides/models-and-aliases" },
          { text: "Limits, budgets and caching", link: "/guides/limits-budgets-and-caching" },
          { text: "Tools, structured output and images", link: "/guides/tools-output-and-images" },
          { text: "History, usage and monitoring", link: "/guides/history-usage-and-monitoring" },
          { text: "Serving other machines", link: "/guides/serving-other-machines" },
        ],
      },
      {
        text: "Clients",
        collapsed: true,
        items: [
          { text: "All clients", link: "/clients/" },
          { text: "Any OpenAI-compatible app", link: "/clients/any-app" },
          {
            text: "SDKs",
            collapsed: true,
            items: [
              { text: "OpenAI Python", link: "/clients/openai-python" },
              { text: "OpenAI JS", link: "/clients/openai-js" },
              { text: "Anthropic Python", link: "/clients/anthropic-python" },
              { text: "Anthropic TypeScript", link: "/clients/anthropic-js" },
              { text: "Google GenAI Python", link: "/clients/google-genai-python" },
              { text: "Google GenAI JS", link: "/clients/google-genai-js" },
              { text: "Vercel AI SDK", link: "/clients/vercel-ai-sdk" },
              { text: "Vercel AI SDK (Anthropic)", link: "/clients/vercel-ai-sdk-anthropic" },
              { text: "Vercel AI SDK (Google)", link: "/clients/vercel-ai-google" },
              { text: "Go (go-openai)", link: "/clients/go-openai" },
              { text: ".NET (openai-dotnet)", link: "/clients/openai-dotnet" },
              { text: "Rust (async-openai)", link: "/clients/async-openai" },
            ],
          },
          {
            text: "Agent frameworks",
            collapsed: true,
            items: [
              { text: "LangChain Python", link: "/clients/langchain-python" },
              { text: "LangChain Python (Anthropic)", link: "/clients/langchain-anthropic-python" },
              { text: "LangChain Google GenAI", link: "/clients/langchain-google-genai" },
              { text: "LangChain JS", link: "/clients/langchain-js" },
              { text: "LangChain JS (Anthropic)", link: "/clients/langchain-anthropic-js" },
              { text: "pydantic-ai", link: "/clients/pydantic-ai" },
              { text: "pydantic-ai (Anthropic)", link: "/clients/pydantic-ai-anthropic" },
              { text: "OpenAI Agents SDK", link: "/clients/openai-agents" },
              { text: "OpenAI Agents SDK (JS)", link: "/clients/openai-agents-js" },
              { text: "CrewAI", link: "/clients/crewai" },
              { text: "AutoGen / AG2", link: "/clients/autogen" },
              { text: "Semantic Kernel", link: "/clients/semantic-kernel" },
              { text: "LlamaIndex", link: "/clients/llamaindex" },
              { text: "Haystack", link: "/clients/haystack" },
              { text: "Mastra", link: "/clients/mastra" },
              { text: "smolagents", link: "/clients/smolagents" },
              { text: "Instructor", link: "/clients/instructor" },
              { text: "DSPy", link: "/clients/dspy" },
              { text: "LiteLLM (as a client)", link: "/clients/litellm-client" },
              { text: "Spring AI", link: "/clients/spring-ai" },
              { text: "LangChain4j", link: "/clients/langchain4j" },
            ],
          },
          {
            text: "Chat apps and automation",
            collapsed: true,
            items: [
              { text: "Open WebUI", link: "/clients/open-webui" },
              { text: "LibreChat", link: "/clients/librechat" },
              { text: "LobeChat", link: "/clients/lobechat" },
              { text: "Chatbox", link: "/clients/chatbox" },
              { text: "Jan", link: "/clients/jan" },
              { text: "AnythingLLM", link: "/clients/anythingllm" },
              { text: "SillyTavern", link: "/clients/sillytavern" },
              { text: "n8n", link: "/clients/n8n" },
              { text: "Dify", link: "/clients/dify" },
              { text: "Home Assistant (Extended OpenAI)", link: "/clients/home-assistant-extended-openai" },
            ],
          },
          {
            text: "Coding tools",
            collapsed: true,
            items: [
              { text: "Claude Code", link: "/clients/claude-code" },
              { text: "OpenCode", link: "/clients/opencode" },
              { text: "Codex CLI", link: "/clients/codex-cli" },
              { text: "Gemini CLI", link: "/clients/gemini-cli" },
              { text: "Aider", link: "/clients/aider" },
              { text: "Cline", link: "/clients/cline" },
              { text: "Roo Code", link: "/clients/roo-code" },
              { text: "Kilo Code", link: "/clients/kilo-code" },
              { text: "Continue", link: "/clients/continue" },
              { text: "Zed", link: "/clients/zed" },
            ],
          },
          {
            text: "Evaluation and observability",
            collapsed: true,
            items: [
              { text: "promptfoo", link: "/clients/promptfoo" },
              { text: "lm-evaluation-harness", link: "/clients/lm-eval" },
              { text: "Langfuse", link: "/clients/langfuse" },
            ],
          },
          {
            text: "Self-hosted apps",
            collapsed: true,
            items: [
              { text: "Overview", link: "/self-hosted" },
              { text: "Onyx", link: "/self-hosted/onyx" },
              { text: "Frigate", link: "/self-hosted/frigate" },
              { text: "Karakeep", link: "/self-hosted/karakeep" },
              { text: "Khoj", link: "/self-hosted/khoj" },
              { text: "Langflow", link: "/self-hosted/langflow" },
              { text: "LLM Vision", link: "/self-hosted/llm-vision" },
              { text: "Mattermost AI plugin", link: "/self-hosted/mattermost" },
              { text: "Mealie", link: "/self-hosted/mealie" },
              { text: "Nextcloud Assistant", link: "/self-hosted/nextcloud-assistant" },
              { text: "Open Notebook", link: "/self-hosted/open-notebook" },
              { text: "paperless-ai", link: "/self-hosted/paperless-ai" },
              { text: "paperless-gpt", link: "/self-hosted/paperless-gpt" },
              { text: "PR-Agent", link: "/self-hosted/pr-agent" },
              { text: "RAGFlow", link: "/self-hosted/ragflow" },
              { text: "SiYuan", link: "/self-hosted/siyuan" },
              { text: "SparkyFitness", link: "/self-hosted/sparkyfitness" },
              { text: "Tandoor Recipes", link: "/self-hosted/tandoor" },
              { text: "Vane", link: "/self-hosted/vane" },
            ],
          },
        ],
      },
      {
        text: "Reference",
        collapsed: true,
        items: [
          { text: "Configuration", link: "/configuration" },
          { text: "APIs", link: "/apis" },
          { text: "Chat Completions", link: "/chat-completions" },
          { text: "Responses", link: "/responses" },
          { text: "Anthropic Messages", link: "/messages" },
          { text: "Gemini", link: "/gemini" },
          { text: "Legacy completions", link: "/completions" },
          { text: "Files API", link: "/files" },
          { text: "Response headers", link: "/headers" },
          { text: "Errors", link: "/errors" },
          { text: "History", link: "/history" },
          { text: "Remote access", link: "/remote-access" },
          { text: "Warm-up and keep-alive", link: "/warm-up" },
          { text: "TUI usage page", link: "/tui" },
          { text: "Security", link: "/security" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: repo }],
    search: { provider: "local" },
  },
})
