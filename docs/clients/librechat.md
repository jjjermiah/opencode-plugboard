# LibreChat

A ChatGPT-style chat UI. Add plugboard as a custom endpoint, and optionally as an Anthropic endpoint for the [Messages API](../messages.md).

## Connect

The LibreChat container reaches plugboard through the host, so plugboard must bind a non-loopback address with keys set ([Serving other machines](../guides/serving-other-machines.md)). In `librechat.yaml`:

<<< @/../examples/librechat/librechat.yaml#snippet

The OpenAI-shaped endpoint's base URL ends in `/v1`; the Anthropic one is the plugboard origin. Put `PLUGBOARD_KEY` in `.env` and mount the file with `docker-compose.override.yml`:

<<< @/../examples/librechat/docker-compose.override.yml#snippet

`extra_hosts` is for Linux; Docker Desktop provides `host.docker.internal`. Restart with `docker compose down && docker compose up -d`. The files are in [examples/librechat/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/librechat).

## What works

Streaming, tool calls, images and the model list on the OpenAI endpoint; streaming and tools on the Anthropic endpoint.

## Limits

- LibreChat silently drops a custom endpoint that lacks `name`, `baseURL`, `apiKey` or `models` (with `fetch: true` or a non-empty `default`). Check those first when an endpoint is missing.
- An unresolved `${VAR}` fails with "Missing API Key" or "Missing Base URL".
- `titleConvo: true` costs one extra request per conversation; keep `titleModel` a cheap alias.
