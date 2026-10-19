# Cline

A coding agent for VS Code. Use its **OpenAI Compatible** provider.

## Connect

In Cline's settings (gear icon):

- **API Provider:** OpenAI Compatible (not the plain OpenAI provider)
- **Base URL:** `http://127.0.0.1:4010/v1`
- **API Key:** your plugboard key
- **Model:** `fast`, or any name from `/v1/models`
- **Model Configuration:** set **Context Window** and **Max Output Tokens** to the model's real values. Turn on **Image Support** only for a model that takes images.

## What works

Streamed chat, agent mode with tool calls (Cline runs its file and command tools), and image input.

## Limits

- Cline can't look up limits for a custom model name; set them by hand or long tasks get cut off.
- Agent mode needs a model with tool calling.
