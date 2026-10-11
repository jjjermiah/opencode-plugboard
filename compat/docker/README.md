# Docker for Open WebUI and n8n

## Status (2026-10-11): installed, VM not usable, images NOT pulled

- Docker CLI 29.6.2 at `~/.pixi/bin/docker`, runtime is colima (`~/.pixi/bin/colima`, profile `default`, vz, 4 CPU, 8 GiB). Context `colima` is active.
- `colima start` fails: `failed to run attach disk "colima", in use by instance "colima"`. `~/.local/share/lima/_disks/colima/in_use_by` is a stale symlink to `~/.local/share/lima/colima` from a previous run (disk last written 2026-10-09; no lima/colima process is running).
- Prep did not touch the VM disk lock because it is the user's VM data. To unblock, confirm nothing runs (`ps aux | grep -E "limactl|lima"` shows no `ha`/vz process for colima), then `rm ~/.local/share/lima/_disks/colima/in_use_by && colima start`. Pull and stop afterwards (`colima stop`) if you do not need it running.
- No OrbStack, no Docker Desktop, no podman.
- The commands below are written but **not run**; verify them when the VM is up.

Plugboard listens on `0.0.0.0:4010`, so containers reach it at `http://host.docker.internal:4010/v1` (with `--add-host host.docker.internal:host-gateway`, which colima's Docker needs). Fallback: `http://10.0.1.103:4010/v1`. Check from inside: `docker run --rm --add-host host.docker.internal:host-gateway curlimages/curl -s http://host.docker.internal:4010/healthz`.

## Open WebUI

```sh
docker pull ghcr.io/open-webui/open-webui:main      # large image (several GB)

docker run -d --name plugboard-compat-owui -p 3000:8080 \
  --add-host host.docker.internal:host-gateway \
  -e OPENAI_API_BASE_URL=http://host.docker.internal:4010/v1 \
  -e OPENAI_API_KEY="$(cat ~/.cache/opencode-adapter-dev/.compat-key)" \
  -e ENABLE_OLLAMA_API=false \
  -e WEBUI_AUTH=false \
  -e WEBUI_SECRET_KEY=compat-test \
  -v plugboard-compat-owui:/app/backend/data \
  ghcr.io/open-webui/open-webui:main
# UI: http://localhost:3000  (WEBUI_AUTH=false = single user, no login; cannot be switched back once data exists, use a fresh volume)
docker logs -f plugboard-compat-owui
# done:
docker stop plugboard-compat-owui && docker rm plugboard-compat-owui && docker volume rm plugboard-compat-owui
```

If the model list stays empty: Admin Panel > Settings > Connections > OpenAI API, check URL `http://host.docker.internal:4010/v1` and key, press the verify button. Open WebUI calls `GET /v1/models` there. The model dropdown will show 458 ids; type `fast`.

Tool calling: Open WebUI has two modes per model (Workspace > Models > edit > Advanced Params > Function Calling): `default` (prompt-injected tools, the model answers with text) and `native` (real OpenAI `tools` in the request, the path plugboard serves). Test `native` for S2. You need a tool: Admin Panel > Functions/Tools, or enable a built-in tool (e.g. calculator / time) in a chat. Also check the title/tags generation calls Open WebUI fires after each chat (extra requests, `response_format` may be used).

## n8n

```sh
docker pull docker.n8n.io/n8nio/n8n:latest

docker run -d --name plugboard-compat-n8n -p 5678:5678 \
  --add-host host.docker.internal:host-gateway \
  -e N8N_SECURE_COOKIE=false \
  -e GENERIC_TIMEZONE=America/Toronto \
  -v plugboard-compat-n8n:/home/node/.n8n \
  docker.n8n.io/n8nio/n8n:latest
# UI: http://localhost:5678 (create the owner account on first visit, any local email/password)
# done:
docker stop plugboard-compat-n8n && docker rm plugboard-compat-n8n && docker volume rm plugboard-compat-n8n
```

OpenAI credentials with a custom base URL (UI): Credentials > Create > "OpenAI API" > API Key = the compat key, **Base URL** = `http://host.docker.internal:4010/v1` (the field exists on that credential; default `https://api.openai.com/v1`) > Save (n8n tests it by calling `/v1/models`).

Workflow for S1 to S4/S6: Manual trigger > "AI Agent" node with sub-node "OpenAI Chat Model" (credential above, model: pick from the list or expression `fast`; if the node's model dropdown only offers OpenAI names, switch to "By ID" mode and type `fast`). Turn the "Use Responses API" option **off** (plugboard serves only Chat Completions). For S2, give the Agent a tool, e.g. the built-in "Calculator" or "Date & Time" tool, and ask a question that needs it. For S1 alone use "Basic LLM Chain" with the same model node. n8n can also be driven headless through its REST API after creating the workflow once; export the workflow JSON and commit it under `compat/docker/` with your results.
