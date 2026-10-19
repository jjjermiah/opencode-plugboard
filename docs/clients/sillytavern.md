# SillyTavern

A chat and roleplay front end. Use the **Custom (OpenAI-compatible)** source.

## Connect

**API Connections → API: Chat Completion → Chat Completion Source: Custom (OpenAI-compatible)**:

- **Endpoint:** `http://127.0.0.1:4010/v1` (don't add `/chat/completions`)
- **API key:** your plugboard key
- **Model:** picked from the dropdown, which fills from `/v1/models`

Press **Test Message** to confirm. A compose file for SillyTavern itself is in [examples/sillytavern/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/sillytavern).

## What works

Chat with streaming, and tool calls when prompt post-processing is **None** or a "with tools" variant.

## Limits

- The **Strict** and **Single user message** post-processing options merge roles; you don't need them with plugboard.
