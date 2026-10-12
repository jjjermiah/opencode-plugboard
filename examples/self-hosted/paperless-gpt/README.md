# paperless-gpt with plugboard

Runs paperless-gpt beside an existing paperless-ngx, with suggestions and LLM OCR on plugboard. Full notes are in [docs/self-hosted/paperless-gpt.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/self-hosted/paperless-gpt.md). Docs-verified, not run.

paperless-gpt has no authentication. The compose file publishes its port on the host loopback only. Keep it that way, or put it behind an authenticated proxy.

## 1. Plugboard

Add the `paperless-gpt` key and the `text` and `vision` aliases from the page's plugboard options block. Bind a non-loopback address and set `keys`, then restart OpenCode.

## 2. paperless-gpt

```sh
cp .env.example .env
# Set PAPERLESS_BASE_URL, PAPERLESS_API_TOKEN and the plugboard key in .env.
docker compose up -d
```

`PAPERLESS_BASE_URL` must be an address the container reaches. If paperless-ngx runs on the same compose network, use its service name.

## 3. Check

```sh
curl -s http://127.0.0.1:4010/healthz
curl -s http://127.0.0.1:4010/v1/models -H "Authorization: Bearer $PLUGBOARD_KEY_PAPERLESS_GPT"
```

Open http://127.0.0.1:8080 and run a suggestion on one document before you enable auto-processing.
