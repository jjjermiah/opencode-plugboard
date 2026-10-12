# LibreChat with plugboard

LibreChat custom endpoints for plugboard: one OpenAI-shaped endpoint and one native Anthropic endpoint. The client guide is [docs/clients/librechat.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/clients/librechat.md), which has the plugboard options (app `librechat`, which must bind a non-loopback address).

- `librechat.yaml`: the two endpoints. Copy it to the LibreChat project root.
- `docker-compose.override.yml`: mounts `librechat.yaml` into the `api` service. Put it next to LibreChat's `docker-compose.yml`.
- `.env.example`: the `PLUGBOARD_KEY` variable. Add it to LibreChat's `.env`.

Then run `docker compose down && docker compose up -d`. Both endpoints should appear in the endpoint menu. If one is missing, check the fields LibreChat requires for a custom endpoint, as the client guide describes.

Not run against plugboard yet.
