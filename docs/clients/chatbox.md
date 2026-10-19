# Chatbox

A desktop and mobile chat app. Add plugboard under **Settings → Model Provider → Add**.

## Connect (OpenAI)

- **Provider type:** OpenAI API compatible
- **API Host:** `http://127.0.0.1:4010/v1`
- **API Path:** leave the default
- **API Key:** your plugboard key
- **Models:** add `fast` or any id from `/v1/models`

Press **Check** to confirm the endpoint answers.

## Connect (Gemini)

- **Provider type:** Google Gemini compatible
- **API Host:** `http://127.0.0.1:4010` (no `/v1`)
- **API Key:** your plugboard key
- **Models:** add `fast`

This uses plugboard's [Gemini API](../gemini.md).

## What works

Streamed chat, and image input on models where you enable vision.

## Limits

- Don't add `/chat/completions` to the host; Chatbox adds the path, and a doubled path answers 404.
- Set each model's capabilities (vision, tools) by hand; Chatbox doesn't read them from plugboard.
