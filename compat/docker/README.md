# Docker clients: Open WebUI and n8n

Both UIs run in containers pinned to the versions in `../results/`: Open WebUI `0.12.0` and n8n `2.42.6`. Both are bound to `127.0.0.1` on the host. Only the owner of the machine should reach them.

## Reaching plugboard from a container

Plugboard listens on `127.0.0.1:4010` by default. Docker Desktop and similar runtimes let a container reach the host as `host.docker.internal`. On Linux add `--add-host host.docker.internal:host-gateway`, and note that a service bound to loopback is not reachable that way. Either point the container at the capture proxy (below), or listen on an address the container can reach and keep `keys` set.

The scripts read `DOCKER_HOST_NAME` (default `host.docker.internal`), `PLUGBOARD_PORT` (default `4010`) and `PLUGBOARD_KEY`. They put `tools/logproxy.py` between the container and plugboard so the exchanges can be read afterwards. The proxy binds `127.0.0.1` unless `LOGPROXY_HOST` says otherwise. Anything that can reach the proxy can use the key it forwards, so widen `LOGPROXY_HOST` only on a machine you trust, and stop the proxy when you finish. Captures in `compat/traffic/` hold prompts, responses and keys; do not commit or share them.

## Open WebUI

`open-webui.sh` is the command log for the 2026-10-11 run, grouped by step. Read it and run steps by hand. Minimal start:

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
