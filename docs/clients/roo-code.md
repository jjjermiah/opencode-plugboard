# Roo Code

A VS Code coding agent (a Cline fork). Use its **OpenAI Compatible** provider.

## Connect

In the Roo Code settings panel:

- **API Provider:** OpenAI Compatible
- **Base URL:** `http://127.0.0.1:4010/v1`
- **API Key:** your plugboard key
- **Model:** `fast`, or any name from `/v1/models` that supports tool calling
- **Model Configuration:** set **Context Window** and **Max Output Tokens** to the model's real values; turn on **Image Support** only for a model that takes images. **Input Price** and **Output Price** are for Roo's own cost display.

## What works

Streamed chat, tasks with native tool calls (Roo runs the tools; plugboard streams tool-call arguments), and image input.

## Limits

- Roo Code uses native tool calling only, so the model must support tools.
- Set the context window and max output tokens by hand for a custom model name.
