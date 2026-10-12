# Nextcloud Assistant (integration_openai)

Nextcloud's Artificial Intelligence features run through the `integration_openai` app. The app connects any number of OpenAI-compatible services, and an admin picks which models each service exposes for each task.

| | |
| --- | --- |
| Upstream | [nextcloud/integration_openai](https://github.com/nextcloud/integration_openai) (the app repo, 76 stars; Nextcloud itself is much larger) |
| Config source | the app's README, "Admin settings" and "Personal settings" sections |
| Plugboard API | `/v1/chat/completions`, with tools and images |
| Status | Chat, tools and text tasks are listed as features. Image generation, speech-to-text and text-to-speech are not possible. docs-verified, not run (checked 2026-10-11) |

## Plugboard options

```jsonc
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "nextcloud": "{env:PLUGBOARD_KEY_NEXTCLOUD}" },
    "models": ["opencode-go/glm-5.3-flash", "anthropic/claude-sonnet-4-6"],
    "aliases": {
      "text": "opencode-go/glm-5.3-flash",
      "vision": "anthropic/claude-sonnet-4-6"
    },
    "apps": { "nextcloud": { "models": ["text", "vision"] } }
  }
}
```

Nextcloud asks for a model name per modality. Pick `text` for text tasks and `vision` for image analysis or OCR.

## Nextcloud config

In the admin settings, open the **Artificial intelligence** section (the README's wording). Add a service and set:

- **Base URL**: `http://host.docker.internal:4010/v1`. Use the address the Nextcloud server reaches. The README says to use "the OpenAI-compatible endpoint" of each service.
- **API key**: the plugboard app key.
- **Models**: for each modality, choose the models to expose. Choose `text` and `vision` for the text modality. Leave the image, transcription and speech modalities off.

The README says any number of services can be connected, and each user may set a personal key for a service. Users with a personal key are not limited by that service's admin quota. Skip personal keys unless you want per-user quotas.

## What works and what does not

- **Text tasks**: free prompt, chat, summarize, headline, topics, context write, reformulate, improve, emoji, change tone, proofread, reformat paragraphs and translate. The README says context write, summarize, headline and reformulate were mainly tested with OpenAI.
- **Chat with tools**: listed as a feature. Plugboard returns the tool calls and Nextcloud runs them (see [Tool calls](../clients/any-app.md#tool-calls)). Not run here.
- **Image analysis and OCR**: listed under text models, "when the service accepts the matching attachments". Needs a vision model, so the `vision` alias. Not run here.
- **Image generation**: not possible. Plugboard serves no image generation.
- **Transcription and subtitles**: not possible. Plugboard serves no audio.
- **Text to speech**: not possible.

## Gotchas

- The README says to run 4 background job workers in the main server, so AI tasks do not wait on each other.
- The README says the app is "mainly tested with OpenAI" and that other services "might work". Test each task you use against plugboard before you rely on it.
- Quotas are per service and can be set in the admin section. Plugboard's own `limits` and `budgets` apply separately.

## Sources

- [integration_openai README](https://github.com/nextcloud/integration_openai/blob/main/README.md)
- [Nextcloud AI overview (admin manual)](https://docs.nextcloud.com/server/latest/admin_manual/ai/overview.html)
