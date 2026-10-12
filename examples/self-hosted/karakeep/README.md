# Karakeep with plugboard

Points Karakeep's inference at plugboard, for tagging (text) and image tagging (vision). Full notes and what does not work are in [docs/self-hosted/karakeep.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/self-hosted/karakeep.md). Docs-verified, not run.

## 1. Plugboard

Add the `karakeep` key and the `tag` and `vision` aliases from the page's plugboard options block to `~/.config/opencode/opencode.jsonc`. The bind must be non-loopback, and `keys` must be set (see [Remote access](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/remote-access.md)). Restart OpenCode after changing `listen`.

## 2. Karakeep

Make a directory, then download Karakeep's compose file and copy in this example's two files:

```sh
mkdir karakeep && cd karakeep
wget https://raw.githubusercontent.com/karakeep-app/karakeep/main/docker/docker-compose.yml
cp <this repo>/examples/self-hosted/karakeep/docker-compose.override.yml .
cp <this repo>/examples/self-hosted/karakeep/.env.example .env
```

Edit `.env`: set `NEXTAUTH_SECRET` and `MEILI_MASTER_KEY` (the upstream install step gives the `openssl rand` command), set `NEXTAUTH_URL`, and put the plugboard `karakeep` key in `OPENAI_API_KEY`. Compose reads `.env` through `env_file`, so no shell export is needed.

```sh
docker compose up -d
```

## 3. Check

Use the key from `.env` in place of the placeholder:

```sh
curl -s http://127.0.0.1:4010/healthz
curl -s http://127.0.0.1:4010/v1/models -H "Authorization: Bearer <the karakeep app key>"
```

Then save a bookmark in Karakeep and wait for its tags.
