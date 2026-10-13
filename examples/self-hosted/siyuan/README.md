# SiYuan with plugboard

Runs SiYuan in Docker with its one OpenAI provider on plugboard, for writing and chat. Full notes are in [docs/self-hosted/siyuan.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/self-hosted/siyuan.md). Docs-verified, not run.

SiYuan's Q/A and embeddings need a separate embedding provider. Plugboard serves no embeddings, so that is not configured here.

## 1. Plugboard

Add the `siyuan` key and the `writing` alias from the page's plugboard options block. Bind a non-loopback address and set `keys`, then restart OpenCode. The container reaches plugboard through `host.docker.internal`, so see [Remote access](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/remote-access.md) for the bind.

## 2. SiYuan

```sh
cp .env.example .env
# Set SIYUAN_ACCESS_AUTH_CODE and SIYUAN_OPENAI_API_KEY in .env.
mkdir -p workspace && sudo chown -R 1000:1000 workspace   # match PUID and PGID
docker compose up -d
```

## 3. Check

```sh
curl -s http://192.0.2.10:4010/v1/models -H "Authorization: Bearer <the siyuan app key>"
```

Open http://127.0.0.1:6806, unlock with the access code, and find the AI settings (the menu path was not checked). Confirm they show the plugboard base URL and the `writing` model before you run a writing request.
