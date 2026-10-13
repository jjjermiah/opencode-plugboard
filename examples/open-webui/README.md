# Open WebUI with plugboard

Runs [Open WebUI](https://github.com/open-webui/open-webui) in Docker and points its OpenAI connection at plugboard on the host. The chat models are the ones your OpenCode server is signed in to, and plugboard's `fast` alias picks the default.

Tested against Open WebUI 0.12.0: see [docs/clients/open-webui.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/clients/open-webui.md) for what passed and the gotchas (about 30 built-in tools per request, extra title and tag requests per turn).

## What this example shows

The runner drives Open WebUI over its HTTP API, the same endpoints its frontend calls. No browser. Each file is one scenario:

| File | Scenario | What it calls |
| --- | --- | --- |
| [`chat.ts`](chat.ts) | S1 plain chat | `POST /api/chat/completions`, non-stream |
| [`tools.ts`](tools.ts) | S2 tool call, then the tool result | a chat record, then the completion with `tool_ids` |
| [`stream.ts`](stream.ts) | S3 streaming text, with and without usage | `POST /api/chat/completions` with `stream: true` |
| [`stream_tools.ts`](stream_tools.ts) | S4 streaming tool call | the S2 turn on the streamed path |
| [`image.ts`](image.ts) | S5 image as a data URL | `image_url` part in a chat |
| [`structured.ts`](structured.ts) | S6 structured output | `response_format` passed through |
| [`models.ts`](models.ts) | S7 list models | `GET /api/models` |
| [`wrong_key.ts`](wrong_key.ts) | E1 wrong key | `POST /openai/verify`, the Verify button's call |

E2 (unknown model) is `n/a`: Open WebUI checks the model id against its own list and answers `400 Model not found` itself, so the request never reaches plugboard.

`owui.ts` is the small shared client (the call helper and the token). `run.ts` starts the container from the image pinned in `docker-compose.yml`, signs in, creates the Weather tool the tool scenarios use, and runs the scenarios.

## 1. Plugboard options

Plugboard must accept connections from the container, so it binds a non-loopback address and needs a key. Add this to the plugin entry in `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "plugins": [
    {
      "package": "opencode-plugboard@0.28.0",
      "options": {
        // Reachable from the container. Bind the docker bridge address (`ip addr show docker0`)
        // or 0.0.0.0, and keep the host firewall closed to everything else.
        "listen": { "host": "0.0.0.0", "port": 4010 },
        "keys": { "open-webui": "{env:PLUGBOARD_KEY_OPEN_WEBUI}" },
        "models": ["opencode-go/glm-5.3-flash"],
        "aliases": { "fast": "opencode-go/glm-5.3-flash" }
      }
    }
  ]
}
```

Every alias target must also be in `models`. Replace the model with one you are signed in to. A non-loopback bind takes effect after an OpenCode restart, and the key is plain HTTP on the wire, so keep this on a network you trust (see [reaching plugboard from another host or container](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/clients/any-app.md#reaching-plugboard-from-another-host-or-container)).

## 2. Key

Pick a long random key and export it in the shell that runs Docker Compose. It must equal the `open-webui` value in the options above:

```sh
export PLUGBOARD_KEY_OPEN_WEBUI="$(openssl rand -hex 32)"
```

## 3. Start Open WebUI

```sh
cd examples/open-webui
docker compose up -d
```

Open http://127.0.0.1:3000, create the admin account, and pick `fast` in the model list. The compose file sets `DEFAULT_MODELS` to `fast`, so new chats start on it.

Check the connection from the host before you open the UI:

```sh
curl -s http://127.0.0.1:4010/healthz
curl -s http://127.0.0.1:4010/v1/models -H "Authorization: Bearer $PLUGBOARD_KEY_OPEN_WEBUI"
```

## Run the example

The runner starts its own container (a fresh volume, a free port, background generation off) and stops it at the end. Docker is required, so `--docker` is needed; without it `run.ts all` skips this example.

Scripted, deterministic, the output committed under `runs/scripted/`:

```sh
bun examples/_harness/run.ts open-webui --target scripted --docker
```

Live, only against the isolated server from [docs/development.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/development.md), never your everyday OpenCode:

```sh
PLUGBOARD_BASE_URL=http://127.0.0.1:4010/v1 PLUGBOARD_KEY=<compat key> \
  bun examples/_harness/run.ts open-webui --target live --docker
```

The live run writes `runs/live/<date>-<commit>/`. Old runs are not rewritten; the record from 2026-10-11 is `runs/live/2026-10-11-f351307/REPORT.md`, migrated unchanged from `compat/results/open-webui.md`.

## Run one file

Start Open WebUI yourself (step 3, or any container with an OpenAI connection to plugboard), sign in, and call a scenario file on its own. `OWUI_UPSTREAM` is the plugboard `/v1` address as the container sees it (used only by `wrong_key.ts`):

```sh
TOKEN=$(curl -s -X POST http://127.0.0.1:3000/api/v1/auths/signin -H 'content-type: application/json' \
  -d '{"email":"admin@localhost","password":"admin"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')
OWUI_BASE=http://127.0.0.1:3000 OWUI_TOKEN="$TOKEN" OWUI_UPSTREAM=http://host.docker.internal:4010/v1 MODEL=fast bun examples/open-webui/chat.ts
```

## Gotchas

- **Tool calls run on the streamed path.** Open WebUI runs the tool loop only when the request has `stream: true`, the way its UI sends it. A non-stream request stops after the first tool call (S2 uses the streamed path for this reason).
- **The completion POST returns before the turn runs.** With a `chat_id` it answers `{"status":true,"task_ids":[...]}` at once. The answer and the tool call are in the stored chat message once it is `done`. S2 and S4 poll for that.
- **Native mode is the default.** Anything but `"function_calling": "legacy"` sends real `tools`, which is the path plugboard serves. In 0.12.0 there is no separate `default` mode.
- **About 31 built-in tools per chat.** Open WebUI adds its own tools (timestamps, chat search, notes, calendar, ...) to every request, even when none is selected. The tool scenarios (S2 and S4) carry them too: their scripted transcripts show 33 tools per request, the example's own tool plus Open WebUI's. Set plugboard's `maxTools` above that (the default 64 is enough).
- **Background calls.** With the UI defaults, each chat turn also sends three non-stream calls to the same model: follow-ups, title and tags. The example turns them off (`ENABLE_*_GENERATION=False`), so the scripted model is never asked an unscripted prompt. The old record measured them.
- **Structured output has no UI.** Open WebUI forwards `response_format` unchanged, which is what S6 tests.
- **Unknown model is answered by Open WebUI.** It returns `400 Model not found` before any request reaches plugboard (E2 is `n/a`).
- **The model list has duplicate ids.** Plugboard returns 387 ids, unique at the time of the 0.12.0 record. Open WebUI shows what it is given.
- **Reasoning tokens.** Plugboard's usage fields for `fast` can disagree between streamed and non-stream answers. Open WebUI only displays them. See the record.
- **Docker bind.** A `--docker` run listens on `0.0.0.0` for as long as it runs, so the container can reach the proxy. The proxy does not hold the key, it forwards the caller's, so a stranger on the network still needs the key. Run it on a machine you trust.
