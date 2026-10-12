# Khoj

Khoj is a personal AI that chats over your notes, documents and the web. It uses a chat model for its answers and for intermediate steps such as intent detection and web search.

| | |
| --- | --- |
| Upstream | [khoj-ai/khoj](https://github.com/khoj-ai/khoj) (about 37.6k stars, last push 2026-08-02) |
| Config source | `documentation/docs/advanced/use-openai-proxy.md` and `documentation/docs/get-started/setup.mdx` in the same repo |
| Plugboard API | `/v1/chat/completions` |
| Status | Chat works. Its search model was not checked, so it may need embeddings from elsewhere. docs-verified, not run (checked 2026-10-11) |

## Plugboard options

```jsonc
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "khoj": "{env:PLUGBOARD_KEY_KHOJ}" },
    "models": ["opencode-go/glm-5.3-flash"],
    "aliases": { "chat": "opencode-go/glm-5.3-flash" },
    "apps": { "khoj": { "models": ["chat"] } }
  }
}
```

## Khoj config

Khoj's docs set the provider in the admin panel, not in the environment:

1. Open the admin panel. Create an **API Model API** (the docs name it "AI model API"). Set **Api Base Url** to `http://host.docker.internal:4010/v1`, and the API key to the plugboard app key. The docs say the base URL is "the URL of your OpenAI compatible API".
2. Create a **Chat Model**. Set **Model Type** to `Openai`, and the model name to the alias `chat`. Leave the tokenizer unset for OpenAI-style models, per the docs.
3. Open your settings and select that chat model.

The compose file also has `OPENAI_API_KEY` and a commented `OPENAI_BASE_URL`. Those are for the first-run setup. The admin panel is the place to change it afterwards.

## What works and what does not

- **Chat**: through the `chat` alias.
- **Intermediate steps and web search**: the docs say the same chat model handles them. Not run against plugboard here.
- **Search (embeddings)**: not verified. If Khoj's search model needs an embedding model, plugboard cannot serve it. Check the admin panel after setup and name the provider it uses.
- **Audio and images**: not checked.

## Gotchas

- The admin panel needs `KHOJ_ADMIN_PASSWORD` and `KHOJ_DJANGO_SECRET_KEY` set in the compose file (the docs say to set both to something secure).
- A reverse proxy in front of Khoj needs `KHOJ_ALLOWED_DOMAIN` set, per the docs. This is separate from plugboard.

## Sources

- [Use an OpenAI API proxy](https://github.com/khoj-ai/khoj/blob/master/documentation/docs/advanced/use-openai-proxy.md)
- [Setup](https://github.com/khoj-ai/khoj/blob/master/documentation/docs/get-started/setup.mdx)
