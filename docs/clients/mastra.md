# Mastra

Run 2026-10-12 against the scripted fake plugboard, not the live dev server (nothing listened on `127.0.0.1:4010`): `@mastra/core` 1.76.0, run with `bun`. The script ran as [examples/mastra/agent.ts](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/mastra). With `model: { id: "plugboard/fast", url, apiKey }`: `text: pass`, `stream: pass`, `tool call: pass`, `tool round trip: pass`. With the issue's bare `id: "fast"`: `Failed to resolve model configuration`, so the issue's snippet is wrong. Model object fields and `api: "responses"` were checked against Mastra's model providers docs (mastra.ai/models).

Mastra is a TypeScript agent framework. Its model router sends an OpenAI-compatible custom `url` through Chat Completions, so plugboard gets `POST /v1/chat/completions`.

## Plugboard options

```jsonc
"options": {
  "keys": { "mastra": "{env:PLUGBOARD_KEY_MASTRA}" },
  "models": ["anthropic/claude-haiku-4-5"],
  "aliases": { "fast": "anthropic/claude-haiku-4-5" }
}
```

Every alias target must also be in `models`.

## Mastra config

```sh
npm i @mastra/core zod
```

```ts
import { Agent } from "@mastra/core/agent";

const agent = new Agent({
  id: "plugboard-agent",
  name: "Plugboard",
  instructions: "Be concise.",
  model: {
    id: "plugboard/fast",
    url: "http://127.0.0.1:4010/v1",
    apiKey: "<your plugboard app key>",
  },
});
```

- **`id` takes a prefix.** Mastra's router splits `id` into a provider and a model. `plugboard/fast` routes to the custom endpoint and sends `fast`. A bare `fast` fails to resolve.
- **`url` is the `/v1` base.** Do not add `/chat/completions`.
- Not a bare `"openai/fast"`: that string goes to OpenAI's built-in provider, not to plugboard.

A possible alternative, not run here, is the AI SDK route: `createOpenAICompatible({ name: "plugboard", baseURL: "http://127.0.0.1:4010/v1", apiKey })` from `@ai-sdk/openai-compatible`, then pass the returned model to `Agent`. This was not run.

## Features exercised

- `agent.generate` for text.
- `agent.stream` with `textStream`, which yielded 2 chunks on the fake.
- A tool: `createTool` with a Zod schema, which the agent calls through plugboard, and the tool result is returned in the final text.
- Not run: memory and structured output.

## Quirks

- A custom `url` uses Chat Completions by default. Set `api: "responses"` on the model object if the endpoint serves `/v1/responses` and you need that path. Plugboard serves both.
- Bare-id failure is the most likely mistake; the error does not name the id.
- Mastra's own Responses and Conversations routes are a Mastra server feature. They do not affect consuming plugboard.

## Verified

Run against the fake, as above. The live dev server was not up, so a live run is still open.
