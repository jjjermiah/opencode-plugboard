# Open WebUI

A self-hosted chat UI. Add plugboard as an OpenAI connection.

## Connect

In the UI: Admin Panel → Settings → Connections → OpenAI API, with URL `http://127.0.0.1:4010/v1` (or `http://host.docker.internal:4010/v1` from the container) and your plugboard key. Or set the connection in compose:

<<< @/../examples/open-webui/docker-compose.yml#snippet

Save it as `docker-compose.yml`, export `PLUGBOARD_KEY_OPEN_WEBUI`, and run `docker compose up -d`. A container reaches plugboard only when plugboard binds a non-loopback address with keys set: see [Serving other machines](../guides/serving-other-machines.md).

## What works

- Chat with streaming. Pick a model or type an alias such as `fast`.
- Tools, with Function Calling on its default (native) or `legacy`. Open WebUI runs the tool and sends the result back.
- Image input, and `response_format` through Open WebUI's API.

## Limits

- Every chat carries Open WebUI's built-in tools (about 30), even with none selected, so a short chat costs several thousand prompt tokens.
- Each turn also sends follow-up, title and tag requests to the same model. Turn them off in Open WebUI's task settings if you don't want them.
- Allowing whole providers gives a model list of hundreds of entries. Narrow `models` to what you use.
