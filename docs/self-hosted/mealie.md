# Mealie

Mealie is a recipe manager. Its AI features import recipes from pasted text, a URL or photos, parse ingredients, and match organizers (tags, categories, tools). The provider is set in the app's UI, not in env vars.

| | |
| --- | --- |
| Upstream | [mealie-recipes/mealie](https://github.com/mealie-recipes/mealie) (about 13.5k stars) |
| Config source | `docs/docs/documentation/getting-started/installation/ai-providers.md` in the same repo |
| Plugboard API | `/v1/chat/completions`, with images for photo imports |
| Status | Works, except video audio transcription. docs-verified, not run (checked 2026-10-11) |

## Plugboard options

```jsonc
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "mealie": "{env:PLUGBOARD_KEY_MEALIE}" },
    "models": ["opencode-go/glm-5.3-flash", "anthropic/claude-sonnet-4-6"],
    "aliases": {
      "default": "opencode-go/glm-5.3-flash",
      "image": "anthropic/claude-sonnet-4-6"
    },
    "apps": { "mealie": { "models": ["default", "image"] } }
  }
}
```

`default` is the provider Mealie needs for every AI feature. `image` is optional, and only photo imports use it.

## Mealie provider settings

In Mealie, open the group settings (its doc says "visit your group settings") and add a provider. Set:

- **Base URL**: `http://host.docker.internal:4010/v1`. Mealie's doc gives the same form for Ollama (`.../v1`), so the `/v1` is required.
- **API key**: the plugboard app key. Mealie's doc says a key is required even where the server ignores it, and plugboard checks it.
- **Model**: `default` for the default provider, and `image` for the image provider.

Mealie's doc says to set a default provider before anything works. Image and audio providers are optional and separate.

## What works and what does not

- **Text features**: the AI ingredient parser, recipe import from a URL the scraper cannot read, and content import (text, HTML or schema.org JSON). Served by `default`.
- **Photos**: "Import with AI" from images needs an image provider. The image step is the only one that reads images. Turning the content into a recipe uses the default provider.
- **Organizers**: Mealie matches AI output against the organizers you already have. This needs the default provider only.
- **Video import**: needs an audio provider doing transcription. Plugboard serves no audio, so this feature is not possible through plugboard. Use another provider for it, or leave it off.

## Gotchas

- Mealie's prompts can be overridden with `OPENAI_CUSTOM_PROMPT_DIR`, per the backend config. Plugboard does not change the prompts.
- Each alias target must also be in plugboard's `models`. A target that is not makes the plugin refuse the options.

## Sources

- [AI integration (Mealie docs)](https://github.com/mealie-recipes/mealie/blob/mealie-next/docs/docs/documentation/getting-started/installation/ai-providers.md)
- [Backend config](https://github.com/mealie-recipes/mealie/blob/mealie-next/docs/docs/documentation/getting-started/installation/backend-config.md)
