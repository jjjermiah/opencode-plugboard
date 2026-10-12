import { defineConfig } from "vitepress"

const repo = "https://github.com/jjjermiah/opencode-plugboard"

// The site is built from docs/. The Guide page (index.md) includes the README, so the README stays
// the single source for the quick start and the feature list.
export default defineConfig({
  title: "opencode-plugboard",
  description:
    "Use your ChatGPT, Claude, Copilot and OpenCode Go logins from any OpenAI, Anthropic or Gemini compatible app.",
  base: "/opencode-plugboard/",
  cleanUrls: true,
  lastUpdated: false,
  themeConfig: {
    nav: [
      { text: "Guide", link: "/" },
      { text: "Configuration", link: "/configuration" },
      { text: "Architecture", link: "/architecture" },
      { text: "Clients", link: "/clients/any-app" },
      {
        text: "API",
        items: [
          { text: "Responses", link: "/responses" },
          { text: "Anthropic Messages", link: "/messages" },
          { text: "Gemini", link: "/gemini" },
          { text: "Completions", link: "/completions" },
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
        text: "Reference",
        items: [
          { text: "Configuration", link: "/configuration" },
          { text: "Remote access", link: "/remote-access" },
          { text: "Architecture", link: "/architecture" },
          { text: "Completions", link: "/completions" },
          { text: "History", link: "/history" },
          { text: "Warm-up", link: "/warm-up" },
        ],
      },
      {
        text: "Clients",
        items: [
          { text: "Any app", link: "/clients/any-app" },
          { text: "OpenAI Python SDK", link: "/clients/openai-python" },
          { text: "OpenAI JS SDK", link: "/clients/openai-js" },
          { text: "Vercel AI SDK", link: "/clients/vercel-ai-sdk" },
          { text: "LangChain Python", link: "/clients/langchain-python" },
          { text: "LangChain JS", link: "/clients/langchain-js" },
          { text: "pydantic-ai", link: "/clients/pydantic-ai" },
          { text: "OpenAI Agents SDK", link: "/clients/openai-agents" },
          { text: "LiteLLM (as a client)", link: "/clients/litellm-client" },
          { text: "Instructor", link: "/clients/instructor" },
          { text: "DSPy", link: "/clients/dspy" },
          { text: "Aider", link: "/clients/aider" },
          { text: "Open WebUI", link: "/clients/open-webui" },
          { text: "n8n", link: "/clients/n8n" },
          { text: "Claude Code", link: "/clients/claude-code" },
          { text: "Codex CLI", link: "/clients/codex-cli" },
          { text: "Continue", link: "/clients/continue" },
          { text: "Kilo Code", link: "/clients/kilo-code" },
          { text: "LibreChat", link: "/clients/librechat" },
          { text: "Zed", link: "/clients/zed" },
          { text: "LobeChat", link: "/clients/lobechat" },
          { text: "Chatbox", link: "/clients/chatbox" },
        ],
      },
      {
        text: "Self-hosted apps",
        items: [
          { text: "Overview", link: "/self-hosted" },
          { text: "Karakeep", link: "/self-hosted/karakeep" },
          { text: "Frigate", link: "/self-hosted/frigate" },
          { text: "paperless-gpt", link: "/self-hosted/paperless-gpt" },
          { text: "Mealie", link: "/self-hosted/mealie" },
          { text: "Khoj", link: "/self-hosted/khoj" },
          { text: "Nextcloud Assistant", link: "/self-hosted/nextcloud-assistant" },
          { text: "Mattermost AI plugin", link: "/self-hosted/mattermost" },
          { text: "Open Notebook", link: "/self-hosted/open-notebook" },
          { text: "Langflow", link: "/self-hosted/langflow" },
          { text: "SparkyFitness", link: "/self-hosted/sparkyfitness" },
        ],
      },
      {
        text: "API",
        items: [
          { text: "Responses", link: "/responses" },
          { text: "Anthropic Messages", link: "/messages" },
          { text: "Gemini", link: "/gemini" },
        ],
      },
      {
        text: "Project",
        items: [
          { text: "Compatibility", link: "/compatibility" },
          { text: "Development", link: "/development" },
          { text: "Releasing", link: "/releasing" },
          { text: "Security reviews", link: "/security-reviews" },
          { text: "Red team", link: "/red-team" },
          { text: "Best practices", link: "/best-practices" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: repo }],
    search: { provider: "local" },
  },
})
