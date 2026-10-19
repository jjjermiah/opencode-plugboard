# LibreChat

A ChatGPT-style chat UI. Add plugboard as a custom endpoint, and optionally as an Anthropic endpoint for the [Messages API](../messages.md).

## Connect

The LibreChat container reaches plugboard through the host, so plugboard must bind a non-loopback address with keys set ([Serving other machines](../guides/serving-other-machines.md)). In `librechat.yaml`:

```yaml
version: 1.3.17
cache: true
endpoints:
  custom:
    - name: 'Plugboard'
      apiKey: '${PLUGBOARD_KEY}'
      baseURL: 'http://host.docker.internal:4010/v1'
      models:
        default: ['fast']
        fetch: true
      titleConvo: true
      titleModel: 'fast'
      modelDisplayLabel: 'Plugboard'
    - name: 'Plugboard (Claude)'
      provider: 'anthropic'
      apiKey: '${PLUGBOARD_KEY}'
      baseURL: 'http://host.docker.internal:4010'
      models:
        default: ['fast']
        fetch: false
```

The OpenAI-shaped endpoint's base URL ends in `/v1`; the Anthropic one is the plugboard origin. Put `PLUGBOARD_KEY` in `.env` and mount the file with `docker-compose.override.yml`:

```yaml
services:
  api:
    volumes:
      - type: bind
        source: ./librechat.yaml
        target: /app/librechat.yaml
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

`extra_hosts` is for Linux; Docker Desktop provides `host.docker.internal`. Restart with `docker compose down && docker compose up -d`. A full example is in [examples/librechat/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/librechat).

## What works

Streaming, tool calls, images and the model list on the OpenAI endpoint; streaming and tools on the Anthropic endpoint.

## Limits

- LibreChat silently drops a custom endpoint that lacks `name`, `baseURL`, `apiKey` or `models` (with `fetch: true` or a non-empty `default`). Check those first when an endpoint is missing.
- An unresolved `${VAR}` fails with "Missing API Key" or "Missing Base URL".
- `titleConvo: true` costs one extra request per conversation; keep `titleModel` a cheap alias.
