# paperless-ai with plugboard

Runs paperless-ai beside an existing paperless-ngx, with suggestions and chat on plugboard. Full notes are in [docs/self-hosted/paperless-ai.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/self-hosted/paperless-ai.md). Docs-verified, not run.

Text only. paperless-ai does not send images, and it needs no embedding route from plugboard: its RAG index runs locally. The first start downloads two Hugging Face models, so the host needs access to them or a cache.

The compose file publishes the web UI on the host loopback. Keep it there until setup is done, or put an authenticated proxy in front.

## 1. Plugboard

Add the `paperless-ai` key and the `text` alias from the page's plugboard options block. Bind a non-loopback address and set `keys`, then restart OpenCode.

## 2. paperless-ai

```sh
cp .env.example .env
# Set PAPERLESS_API_URL, PAPERLESS_API_TOKEN, CUSTOM_API_KEY and the paperless-ngx user in .env.
docker compose up -d
```

`PAPERLESS_API_URL` must be an address the container reaches. If paperless-ngx runs on the same compose network, use its service name.

Settings in `.env` win over the same settings in the web UI, because the compose file passes `.env` into the container environment. To change a provider setting, edit `.env` and run `docker compose up -d` again.

## 3. Check

```sh
curl -s http://127.0.0.1:4010/healthz
curl -s http://127.0.0.1:4010/v1/models -H "Authorization: Bearer $PLUGBOARD_KEY_PAPERLESS_AI"
```

Open http://127.0.0.1:3000, finish setup, and run analysis on one document before you enable the scan.
