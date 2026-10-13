# Tandoor Recipes

Tandoor Recipes is a recipe manager. Its AI features import recipes from text, images and PDFs, sort steps and assign ingredients to them, and extract nutrition. Every AI call goes through LiteLLM.

| | |
| --- | --- |
| Upstream | [TandoorRecipes/recipes](https://github.com/TandoorRecipes/recipes) (about 8.7k stars) |
| Config source | `docs/features/ai.md` and `docs/system/configuration.md` in the same repo (commit [bb07441](https://github.com/TandoorRecipes/recipes/tree/bb07441b3cd566dbc6c29ab09dc74b741804ef02)), and `recipes/settings.py` and `cookbook/views/api.py` for the URL check |
| Plugboard API | `/v1/chat/completions`, with images for import from photos or PDFs |
| Status | Works for text import and steps, once the provider and `AI_ALLOWED_URLS` are set. Photo and PDF import needs a vision alias. JSON mode not checked. docs-verified, not run (checked 2026-10-12) |

## Server setting

Tandoor sends a provider's `api_base` only when the provider URL is in `AI_ALLOWED_URLS`. The check in `cookbook/views/api.py` is an exact `in` test on the list from `recipes/settings.py`, so the provider URL and the list entry must match character for character, including the `/v1` and any trailing slash:

```sh
AI_ALLOWED_URLS=http://host.docker.internal:4010/v1
```

A provider URL not on the list makes the request fail with `AI provider URL not allowed`. Set the variable in the Tandoor container environment and restart it.

## Plugboard options

```jsonc
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "tandoor": "{env:PLUGBOARD_KEY_TANDOOR}" },
    "models": ["opencode-go/glm-5.3-flash", "anthropic/claude-sonnet-4-6"],
    "aliases": {
      "import": "anthropic/claude-sonnet-4-6"
    },
    "apps": { "tandoor": { "models": ["import"] } }
  }
}
```

`import` must accept images for photo and PDF import. Text-only aliases work for text import.

## Tandoor provider

Create the provider in the Tandoor UI, or in the Django admin as a superuser for a provider every space can use. Its fields are documented in `docs/features/ai.md`:

```text
Name: Plugboard import
Model name: openai/import
API key: <the tandoor app key>
URL: http://host.docker.internal:4010/v1
Log credit cost: disabled
```

- **Model name**: the `openai/` prefix routes the call through LiteLLM's OpenAI-compatible path. The prefix rule is from PR-Agent's upstream doc. Tandoor's own docs do not describe it for a custom URL, so it is inferred here, not run.
- **URL**: must match `AI_ALLOWED_URLS` exactly (see above).
- **API key**: the plugboard app key, not an OpenAI key. Tandoor requires a non-empty key.
- **Log credit cost**: Tandoor's default is enabled, with about 1 USD a month per space. Tandoor's docs say a provider with cost tracking off is not limited by the monthly credit. Cost comes from LiteLLM's price table, which may not know a plugboard alias. Disabled is the choice when the monthly cap is not needed.

## What works and what does not

- **Text import, step sorting, nutrition**: through the `import` alias.
- **Photo and PDF import**: Tandoor sends `image_url` content. The alias must accept images. The docs say PDF handling depends on the provider, and some accept images only.
- **JSON mode**: Tandoor sends `response_format: {"type": "json_object"}` in its requests (`cookbook/views/api.py`), and its docs say the model must return JSON. Whether plugboard passes `response_format` through to the alias was not checked. Test one import before relying on it.
- **Embeddings**: none used.

## Gotchas

- An empty provider URL makes LiteLLM call OpenAI's own endpoint, not plugboard. Always set the URL.
- Imports are synchronous. A slow alias can hit a reverse proxy timeout.
- The AI import sends the whole file as base64, so large files can exceed the provider's or the proxy's limit.
- `AI_RATELIMIT` defaults to `60/hour`. Raise it for batch imports.
- Keep the plugboard key out of shared notes and screenshots. It is entered in the provider form.

## Sources

- [Tandoor `docs/features/ai.md`](https://github.com/TandoorRecipes/recipes/blob/bb07441b3cd566dbc6c29ab09dc74b741804ef02/docs/features/ai.md) (read 2026-10-12)
- [Tandoor `docs/system/configuration.md`, AI_ALLOWED_URLS](https://github.com/TandoorRecipes/recipes/blob/bb07441b3cd566dbc6c29ab09dc74b741804ef02/docs/system/configuration.md) (read 2026-10-12)
- [Tandoor `recipes/settings.py` and `cookbook/views/api.py`](https://github.com/TandoorRecipes/recipes/blob/bb07441b3cd566dbc6c29ab09dc74b741804ef02/cookbook/views/api.py) (read 2026-10-12)
- [PR-Agent: OpenAI like API](https://github.com/qodo-ai/pr-agent/blob/main/docs/docs/usage-guide/changing_a_model.md), for the `openai/` prefix rule
