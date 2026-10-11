# Docker clients: Open WebUI and n8n

Both UIs run in containers pinned to the versions the scripts use: Open WebUI `0.12.0` and n8n `2.42.6` (the dated results are in `../results/`). Both are bound to `127.0.0.1` on the host. Only the owner of the machine should reach them.

## Reaching plugboard from a container

Plugboard listens on `127.0.0.1:4010` by default, and a container cannot use that: `host.docker.internal` leads to the host's gateway address, not loopback, and a loopback bind answers any other `Host` header with 403 `invalid_host`. The general recipe (non-loopback bind with `keys`, firewall or tunnel, reverse proxy `Host` handling, `host.lima.internal`) is in [docs/clients/any-app.md](../../docs/clients/any-app.md#reaching-plugboard-from-another-host-or-container).

The scripts here take a different route and leave plugboard on loopback. They read `DOCKER_HOST_NAME` (default `host.docker.internal`), `PLUGBOARD_PORT` (default `4010`) and `PLUGBOARD_KEY`, and put `tools/logproxy.py` between the container and plugboard so the exchanges can be read afterwards. The container talks to the proxy, and the proxy talks to `127.0.0.1:4010` with its own `Host` header, which passes the loopback check. The proxy binds `127.0.0.1` unless `LOGPROXY_HOST` says otherwise, and a container needs it on an address it can reach (the docker bridge address, or `0.0.0.0`). Anything that can reach the proxy can use the key it forwards, so widen `LOGPROXY_HOST` only on a machine you trust, and stop the proxy when you finish. Captures in `compat/traffic/` hold prompts, responses and keys; do not commit or share them.

## Open WebUI

`open-webui.sh` is the command log for the 2026-10-11 run, grouped by step. Read it and run steps by hand. It keeps its token and helper script in a private `mktemp -d` directory, and stops the proxy it started by PID when the shell exits. Minimal start (this one points the container at plugboard directly, so plugboard needs the non-loopback bind from the recipe above):

```sh
docker run -d --name plugboard-compat-owui -p 127.0.0.1:3000:8080 \
  --add-host host.docker.internal:host-gateway \
  -e OPENAI_API_BASE_URL=http://host.docker.internal:4010/v1 \
  -e OPENAI_API_KEY="$PLUGBOARD_KEY" \
  -e ENABLE_OLLAMA_API=false \
  -v plugboard-compat-owui:/app/backend/data \
  ghcr.io/open-webui/open-webui:0.12.0
```

Open WebUI calls `GET /v1/models` when you save the connection. Use a fresh volume for each test. Remove it with `docker rm -f plugboard-compat-owui && docker volume rm plugboard-compat-owui`.

Tool calls: leave a model's Function Calling setting at its default. In 0.12.0 anything but `legacy` is native, which sends real `tools` and is the path plugboard serves.

## n8n

`n8n/run.sh` drives n8n headless: `./run.sh up`, `./run.sh scenarios`, `./run.sh down`, or `./run.sh all`. It creates a throwaway owner, API key and credential, and imports the workflows in `n8n/*.json`.

By hand: run `docker.n8n.io/n8nio/n8n:2.42.6` with `-p 127.0.0.1:5678:5678`, create an OpenAI API credential with the plugboard key and Base URL `http://host.docker.internal:4010/v1`, and use an OpenAI Chat Model node. Turn **Use Responses API off**: it defaults to on, and plugboard has no `/v1/responses` yet, so the node fails with a 404.
