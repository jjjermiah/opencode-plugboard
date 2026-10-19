# Tandoor Recipes

Tandoor Recipes is a recipe manager. Its AI features import recipes from text, images and PDFs, sort steps, and extract nutrition. Every AI call goes through LiteLLM.

## Plugboard options

Give Tandoor its own key. `import` must accept images for photo import. Docker needs a reachable address ([Serving other machines](../guides/serving-other-machines.md)).

```jsonc
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "tandoor": "{env:PLUGBOARD_KEY_TANDOOR}" },
    "models": ["opencode-go/glm-5.3-flash", "anthropic/claude-sonnet-4-6"],
    "aliases": { "import": "anthropic/claude-sonnet-4-6" },
    "apps": { "tandoor": { "models": ["import"] } }
  }
}
```

## Connect

Tandoor sends a provider URL only if it is in `AI_ALLOWED_URLS`. Set it in the Tandoor container environment and restart. The match is exact, so the entry and the provider URL must agree character for character, including `/v1` and any trailing slash:

```sh
AI_ALLOWED_URLS=http://host.docker.internal:4010/v1
```

Separate several URLs with commas. A URL not on the list fails with `AI provider URL not allowed`.

Then create the provider in the Tandoor UI, or in the Django admin as a superuser for a provider every space can use:

```text
Name: Plugboard import
Model name: openai/import
API key: <the tandoor key>
URL: http://host.docker.internal:4010/v1
Log credit cost: disabled
```

- **Model name**: LiteLLM needs the `openai/` prefix to route to an OpenAI-compatible URL.
- **API key**: the plugboard key. Tandoor requires a non-empty key.
- **Log credit cost**: disable it. Tandoor's default monthly credit cap prices calls from LiteLLM's table, which does not know plugboard aliases.

## What works

- Text import, step sorting and nutrition, through the `import` alias.
- Photo import. Tandoor sends the image as an `image_url` data URL, and plugboard accepts PNG, JPEG, GIF and WebP.
- JSON mode (`response_format: json_object`).

## Limits

- PDF import fails. Tandoor sends the PDF as an `application/pdf` data URL, and plugboard answers 400 `invalid_image` for anything that is not `image/*`. Import a photo or the text instead.
- Plugboard adds a system instruction for JSON mode. A weak model may ignore it, so test one import first.
- An empty provider URL makes LiteLLM call OpenAI's own endpoint. Always set the URL.
- Imports are synchronous. A slow alias can hit a reverse proxy timeout, and large files sent as base64 can exceed a proxy or provider size limit.
- `AI_RATELIMIT` defaults to `60/hour`. Raise it for batch imports.
