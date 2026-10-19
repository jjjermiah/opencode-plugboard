# Khoj

Khoj is a personal AI that chats over your notes, documents and the web. One chat model writes the answers and handles intent detection and web search.

## Plugboard options

Give Khoj its own key. Docker needs a reachable address ([Serving other machines](../guides/serving-other-machines.md)).

```jsonc plugboard-options
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

## Connect

Set the provider in Khoj's admin panel:

1. Create an **AI model API**. Set **Api Base Url** to `http://host.docker.internal:4010/v1` and the API key to the `khoj` key.
2. Create a **Chat Model**. Set **Model Type** to `Openai` and the model name to `chat`. Leave the tokenizer unset.
3. Open your settings and select that chat model.

The admin panel needs `KHOJ_ADMIN_PASSWORD` and `KHOJ_DJANGO_SECRET_KEY` set in the compose file. Behind a reverse proxy, also set `KHOJ_ALLOWED_DOMAIN`.

## What works

Chat, intent detection and web search, all through the `chat` alias.

## Limits

- Plugboard serves no embeddings. If your Khoj search model needs a separate embedding model, run one yourself.
