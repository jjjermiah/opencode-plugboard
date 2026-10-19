# Mealie

Mealie is a recipe manager. Its AI features import recipes from text, URLs and photos, parse ingredients, and match tags, categories and tools. You set the provider in the UI, not in env vars.

## Plugboard options

Give Mealie its own key. `default` serves every AI feature. `image` is optional and only photo imports use it, so it must accept images. Docker needs a reachable address ([Serving other machines](../guides/serving-other-machines.md)).

```jsonc plugboard-options
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

## Connect

In Mealie's group settings, add a provider:

| Field | Value |
| --- | --- |
| Base URL | `http://host.docker.internal:4010/v1` (with `/v1`) |
| API key | the `mealie` key |
| Model | `default` for the default provider, `image` for the image provider |

Set the default provider first. The image provider is separate and optional.

## What works

- The AI ingredient parser, import from a URL the scraper cannot read, and import from text, HTML or schema.org JSON, all through `default`.
- Photo import ("Import with AI" from images), through `image`. Turning the content into a recipe uses `default`.
- Organizer matching against your existing tags, categories and tools, through `default`.

## Limits

- Video import needs audio transcription, which plugboard does not serve. Use another provider for it, or leave it off.
- Each alias target must also be in `models`, or the plugin refuses the options.
