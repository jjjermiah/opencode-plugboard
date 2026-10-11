#!/usr/bin/env bash
# Open WebUI 0.12.0 against plugboard, as run on 2026-10-11. Not meant to be run top to bottom unattended;
# it is the command log, grouped by step. Run from the plugboard repo root. Never prints the key.
#
# Env: PLUGBOARD_KEY (required), PLUGBOARD_PORT (plugboard port, default 4010),
#      DOCKER_HOST_NAME (how a container reaches this machine, default host.docker.internal),
#      LOGPROXY_HOST (interface the capture proxy binds, default 127.0.0.1; see compat/docker/README.md).
# Captured traffic in compat/traffic/ is sensitive (prompts, responses, tool arguments). Do not commit or share it.
set -u
: "${PLUGBOARD_KEY:?set PLUGBOARD_KEY}"
PLUGBOARD_PORT=${PLUGBOARD_PORT:-4010}
DOCKER_HOST_NAME=${DOCKER_HOST_NAME:-host.docker.internal}
LOGPROXY_HOST=${LOGPROXY_HOST:-127.0.0.1}
LOGPROXY_PORT=4091          # pick a free port
export OWUI_PORT=3091       # host port for Open WebUI, bound to 127.0.0.1
IMAGE=ghcr.io/open-webui/open-webui:0.12.0
CT=plugboard-compat-owui
TD=${TMPDIR:-/tmp}          # scratch for the token and helper script

# 0. Container -> host reachability
docker run --rm --add-host host.docker.internal:host-gateway curlimages/curl -s -m 5 "http://$DOCKER_HOST_NAME:$LOGPROXY_PORT/healthz"; echo   # after step 2

# 1. Pull (several GB)
docker pull $IMAGE

# 2. logproxy between Open WebUI and plugboard. Plugboard on loopback is not reachable from a container on Linux,
#    so LOGPROXY_HOST may need to be the docker bridge address or 0.0.0.0. Anything that can reach the proxy can reuse the
#    key it forwards: bind it to 0.0.0.0 only on a machine you trust, and stop it when done.
python3 compat/tools/logproxy.py --host "$LOGPROXY_HOST" --port $LOGPROXY_PORT --upstream "http://127.0.0.1:$PLUGBOARD_PORT" --out compat/traffic/open-webui.jsonl &
docker run --rm --add-host host.docker.internal:host-gateway curlimages/curl -s -m 5 "http://$DOCKER_HOST_NAME:$LOGPROXY_PORT/healthz"   # {"ok":true}

# 3. Open WebUI, pointed at the logproxy (not at 4010 directly). WEBUI_AUTH=False = single user.
docker volume rm $CT 2>/dev/null
docker run -d --name $CT -p 127.0.0.1:$OWUI_PORT:8080 \
  --add-host host.docker.internal:host-gateway \
  -e OPENAI_API_BASE_URL=http://$DOCKER_HOST_NAME:$LOGPROXY_PORT/v1 \
  -e OPENAI_API_KEY="$PLUGBOARD_KEY" \
  -e ENABLE_OLLAMA_API=false -e WEBUI_AUTH=False -e WEBUI_SECRET_KEY=compat-test \
  -v $CT:/app/backend/data \
  $IMAGE
until curl -s -m 3 localhost:$OWUI_PORT/health; do sleep 5; done; echo     # {"status":true} after ~25 s
curl -s localhost:$OWUI_PORT/api/version                                    # {"version":"0.12.0",...}

# 4. API token. With WEBUI_AUTH=False, GET /api/v1/auths/ returns 401 on a fresh volume;
#    POST /api/v1/auths/signin (any body, it logs in the default admin) returns the token.
curl -s -X POST localhost:$OWUI_PORT/api/v1/auths/signin -H 'content-type: application/json' \
  -d '{"email":"admin@localhost","password":"admin"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])" > $TD/owui.tok
T=$(cat $TD/owui.tok)

# 5. S7: model list as the UI sees it (Open WebUI calls GET /v1/models, merges, dedupes by id)
curl -s -H "Authorization: Bearer $T" localhost:$OWUI_PORT/api/models -o $TD/models.json -w "%{http_code} %{size_download} %{time_total}s\n"
python3 -c "
import json; m=json.load(open('$TD/models.json'))['data']; ids=[x['id'] for x in m]
print(len(ids), len(set(ids)), [i for i in ids if i in ('fast','anthropic/claude-haiku-4-5','openai/gpt-5.6-luna#low')])"
# Connection verify button (also the wrong-key path): POST /openai/verify
curl -s -X POST localhost:$OWUI_PORT/openai/verify -H "Authorization: Bearer $T" -H 'content-type: application/json' \
  -d "{\"url\":\"http://$DOCKER_HOST_NAME:$LOGPROXY_PORT/v1\",\"key\":\"wrongkey\"}"

# 6. S1 non-stream through the Open WebUI API (plain passthrough, no chat record, no aux calls)
curl -s -m 120 localhost:$OWUI_PORT/api/chat/completions -H "Authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"model":"fast","stream":false,"messages":[{"role":"user","content":"Reply with exactly: pong"}]}'

# 7. S3 streaming, with and without stream_options
curl -sN -m 120 localhost:$OWUI_PORT/api/chat/completions -H "Authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"model":"fast","stream":true,"stream_options":{"include_usage":true},"messages":[{"role":"user","content":"Reply with exactly: pong"}]}'
curl -sN -m 120 localhost:$OWUI_PORT/api/chat/completions -H "Authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"model":"fast","stream":true,"messages":[{"role":"user","content":"Reply with exactly: pong"}]}'

# 8. Helper that drives Open WebUI the way its frontend does: POST /api/v1/chats/new, then POST /api/chat/completions with
#    chat_id + message id + session_id + background_tasks (title/tags/follow-ups fire server side), then read the chat back.
#    Without chat_id the API is a bare passthrough and no aux calls happen.
cat > $TD/owui_chat.py <<'PY'
#!/usr/bin/env python3
# usage: owui_chat.py MODEL PROMPT [--tools id1,id2] [--params '{"function_calling":"legacy"}'] [--noaux] [--image dataurlfile]
import json, time, uuid, urllib.request, urllib.error, argparse, os, sys
BASE = "http://localhost:" + os.environ.get("OWUI_PORT", "3091")
TOK = open(os.path.dirname(os.path.abspath(__file__)) + "/owui.tok").read().strip()
def call(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {TOK}", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
ap = argparse.ArgumentParser()
ap.add_argument("model"); ap.add_argument("prompt")
ap.add_argument("--tools", default=""); ap.add_argument("--params", default="{}")
ap.add_argument("--noaux", action="store_true"); ap.add_argument("--image")
a = ap.parse_args()
uid, aid, now = str(uuid.uuid4()), str(uuid.uuid4()), int(time.time())
content = a.prompt
um = {"id": uid, "parentId": None, "childrenIds": [aid], "role": "user", "content": a.prompt, "timestamp": now, "models": [a.model]}
if a.image:
    url = open(a.image).read().strip()
    content = [{"type": "text", "text": a.prompt}, {"type": "image_url", "image_url": {"url": url}}]
    um["files"] = [{"type": "image", "url": url}]
am = {"id": aid, "parentId": uid, "childrenIds": [], "role": "assistant", "content": "", "model": a.model, "modelName": a.model, "timestamp": now}
chat = {"title": "New Chat", "models": [a.model], "history": {"messages": {uid: um, aid: am}, "currentId": aid},
        "messages": [um, am], "params": {}, "timestamp": now * 1000}
s, c = call("POST", "/api/v1/chats/new", {"chat": chat}); cid = c["id"]
body = {"stream": True, "model": a.model, "messages": [{"role": "user", "content": content}],
        "params": json.loads(a.params), "features": {}, "variables": {},
        "session_id": "sess-" + uid[:8], "chat_id": cid, "id": aid, "parent_id": uid, "parent_message": um,
        "background_tasks": {} if a.noaux else {"title_generation": True, "tags_generation": True, "follow_up_generation": True},
        "stream_options": {"include_usage": True}}
if a.tools: body["tool_ids"] = a.tools.split(",")
print("completions", *call("POST", "/api/chat/completions", body))
time.sleep(25)     # the work happens server side after this returns {"status":true,"task_ids":[...]}
s, c = call("GET", f"/api/v1/chats/{cid}")
m = c["chat"]["history"]["messages"][aid]
print("title:", c.get("title"), "| tags:", c.get("meta"))
print("assistant:", json.dumps(m, default=str)[:1500])
PY

# 9. S1/S3 the way the UI does it (adds tools, aux calls)
python3 $TD/owui_chat.py fast "Reply with exactly: pong"

# 10. S2: create a tool (Open WebUI Python tool; admin-only API), then chat with it in each Function Calling mode.
#     In 0.12.0 the modes are: anything but "legacy" = native (real `tools` in the request, the default);
#     "legacy" = prompt-based (old "default"). params.function_calling="default" is NOT legacy: it still sends `tools`.
python3 - <<PY
import json, urllib.request
code = '''"""
title: Weather
description: compat test tool
"""
class Tools:
    def get_weather(self, city: str) -> str:
        """Get the current weather for a city.
        :param city: City name, e.g. Paris
        """
        return '{"temp_c":18,"sky":"cloudy"}'
'''
b = {"id": "weather", "name": "Weather", "content": code, "meta": {"description": "compat test tool", "manifest": {}}, "access_grants": []}
r = urllib.request.Request("http://localhost:$OWUI_PORT/api/v1/tools/create", data=json.dumps(b).encode(),
                           headers={"Authorization": "Bearer $T", "content-type": "application/json"})
print(urllib.request.urlopen(r).read()[:200])
PY
python3 $TD/owui_chat.py fast "What is the weather in Paris? Use the tool." --tools weather --params '{"function_calling":"native"}'
python3 $TD/owui_chat.py fast "What is the weather in Paris? Use the tool." --tools weather --params '{"function_calling":"default"}'
python3 $TD/owui_chat.py fast "What is the weather in Paris? Use the tool." --tools weather --params '{"function_calling":"legacy"}'
for M in anthropic/claude-haiku-4-5 'openai/gpt-5.6-luna#low'; do
  python3 $TD/owui_chat.py "$M" "What is the weather in Paris? Use the tool." --tools weather --noaux
done

# 11. S5 image, direct API with a data URL
for M in fast anthropic/claude-haiku-4-5; do
python3 - "$M" <<PY
import json, sys, urllib.request
url = open('compat/fixtures/red32.dataurl.txt').read().strip()
b = {"model": sys.argv[1], "stream": True, "stream_options": {"include_usage": True},
     "messages": [{"role": "user", "content": [{"type": "text", "text": "What color is this image? One word."}, {"type": "image_url", "image_url": {"url": url}}]}]}
r = urllib.request.Request("http://localhost:$OWUI_PORT/api/chat/completions", data=json.dumps(b).encode(),
                           headers={"Authorization": "Bearer $T", "content-type": "application/json"})
print(sys.argv[1], urllib.request.urlopen(r, timeout=120).read().decode()[:600])
PY
done

# 12. S6 response_format passthrough (Open WebUI has no UI for it; the API forwards the field)
python3 - <<PY
import json, urllib.request
sch = json.load(open('compat/fixtures/meal_estimate.json_schema.json'))
for m in ["fast", "anthropic/claude-haiku-4-5", "openai/gpt-5.6-luna#low"]:
    b = {"model": m, "stream": False, "messages": [{"role": "user", "content": "Estimate: 2 boiled eggs and a slice of toast."}],
         "response_format": {"type": "json_schema", "json_schema": sch}}
    r = urllib.request.Request("http://localhost:$OWUI_PORT/api/chat/completions", data=json.dumps(b).encode(),
                               headers={"Authorization": "Bearer $T", "content-type": "application/json"})
    print(m, json.loads(urllib.request.urlopen(r, timeout=120).read())["choices"][0]["message"]["content"])
PY
# unknown model: Open WebUI answers itself, request never reaches plugboard
curl -s localhost:$OWUI_PORT/api/chat/completions -H "Authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"model":"nope","stream":false,"messages":[{"role":"user","content":"hi"}]}'      # HTTP 400 {"detail":"Model not found"}

# 13. Inspect what was sent
jq -c '{path,status,model:.req_json.model,stream:.req_json.stream,keys:(.req_json|keys?)}' compat/traffic/open-webui.jsonl

# 14. Cleanup (image kept)
docker stop $CT && docker rm $CT && docker volume rm $CT
pkill -f "logproxy.py --host $LOGPROXY_HOST --port $LOGPROXY_PORT"
