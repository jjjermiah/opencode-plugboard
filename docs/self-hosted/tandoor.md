# Tandoor Recipes

Tandoor Recipes is a recipe manager. Its AI features import recipes from text, images and PDFs, sort steps and assign ingredients to them, and extract nutrition. Every AI call goes through LiteLLM.

| | |
| --- | --- |
| Upstream | [TandoorRecipes/recipes](https://github.com/TandoorRecipes/recipes) (about 8.7k stars) |
| Config source | `docs/features/ai.md` and `docs/system/configuration.md` in the same repo (commit [bb07441](https://github.com/TandoorRecipes/recipes/tree/bb07441b3cd566dbc6c29ab09dc74b741804ef02)), and `recipes/settings.py` and `cookbook/views/api.py` for the URL check |
| Plugboard API | `/v1/chat/completions`, with images for import from photos or PDFs |
| Status | Works for text import and steps. Photo import should work with a vision alias. PDF import is expected to fail: plugboard rejects PDF data URLs with 400 `invalid_image`. JSON mode (`json_object`) is supported. docs-verified, not run (checked 2026-10-12) |

## Server setting

Tandoor sends a provider's `api_base` only when the provider URL is in `AI_ALLOWED_URLS`. The check in `cookbook/views/api.py` is an exact `in` test on the list from `recipes/settings.py`, so the provider URL and the list entry must match character for character, including the `/v1` and any trailing slash:

```sh
AI_ALLOWED_URLS=http://host.docker.internal:4010/v1
```

The variable is comma-separated, and each entry is whitespace-trimmed (`extract_comma_list` in `recipes/settings.py`), so several providers go on one line: `AI_ALLOWED_URLS=http://host.docker.internal:4010/v1,https://other.example/v1`.

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

`import` must accept images for photo import. Text-only aliases work for text import. PDF import does not work through plugboard (see below).

## Tandoor provider

Create the provider in the Tandoor UI, or in the Django admin as a superuser for a provider every space can use. Its fields are documented in `docs/features/ai.md`:

```text
Name: Plugboard import
Model name: openai/import
API key: <the tandoor app key>
URL: http://host.docker.internal:4010/v1
Log credit cost: disabled
```

- **Model name**: the `openai/` prefix is inferred from LiteLLM's convention for OpenAI-compatible routing. Tandoor's docs do not describe it for a custom URL, and it is not run here.
- **URL**: must match `AI_ALLOWED_URLS` exactly (see above).
- **API key**: the plugboard app key, not an OpenAI key. Tandoor requires a non-empty key.
- **Log credit cost**: Tandoor's default is enabled, with about 1 USD a month per space. Tandoor's docs say a provider with cost tracking off is not limited by the monthly credit. Cost comes from LiteLLM's price table, which may not know a plugboard alias. Disabled is the choice when the monthly cap is not needed.

## What works and what does not

- **Text import, step sorting, nutrition**: through the `import` alias.
- **Photo import**: Tandoor sends the image as an `image_url` data URL. Plugboard accepts PNG, JPEG, GIF and WebP there, through a vision alias. Expected to work, not run.
- **PDF import**: Tandoor sends the PDF as an `image_url` data URL with media type `application/pdf` (`cookbook/views/api.py`). Plugboard rejects any data URL that is not `image/*` with 400 `invalid_image` (`src/openai/request.ts`, `src/image.ts`). So PDF import is expected to fail through plugboard. Not run. Import photos or text instead.
- **JSON mode**: Tandoor sends `response_format: {"type": "json_object"}` (`cookbook/views/api.py`). Plugboard supports `json_object` by adding a system instruction and stripping one code fence ([completions](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/completions.md)). A weak model may ignore the instruction, so test one import first.
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
- [Plugboard `src/image.ts`](https://github.com/jjjermiah/opencode-plugboard/blob/main/src/image.ts), for the PDF rejection (read 2026-10-12)
- [Tandoor `recipes/settings.py` and `cookbook/views/api.py`](https://github.com/TandoorRecipes/recipes/blob/bb07441b3cd566dbc6c29ab09dc74b741804ef02/cookbook/views/api.py) (read 2026-10-12)
- [PR-Agent: OpenAI like API](https://github.com/qodo-ai/pr-agent/blob/main/docs/docs/usage-guide/changing_a_model.md), for the `openai/` prefix rule
