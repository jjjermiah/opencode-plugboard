#!/usr/bin/env bash
# Drive n8n 2.42.6 (Docker) against plugboard, headless. Run from anywhere.
#   ./run.sh up        start logproxy + n8n, create owner + API key + credential, import + activate workflows
#   ./run.sh scenarios run S1..S7 (+extras) through webhooks, print answers and the plugboard-side HTTP status
#   ./run.sh down      stop/remove container + volume, stop logproxy (image kept)
#   ./run.sh all       up, scenarios, down
# Needs: docker, python3, curl.
# Env: PLUGBOARD_KEY (required), PLUGBOARD_PORT (default 4010), DOCKER_HOST_NAME (how a container reaches this machine,
#      default host.docker.internal), LOGPROXY_HOST (interface the capture proxy binds, default 127.0.0.1; see compat/docker/README.md).
# Captured traffic in compat/traffic/ and the files under $STATE hold the key and prompts. Do not commit or share them.
set -euo pipefail
umask 077

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
STATE="${TMPDIR:-/tmp}/plugboard-compat-n8n"            # cookie jar, API key, credential id (never committed)
CONTAINER=plugboard-compat-n8n
VOLUME=plugboard-compat-n8n
IMAGE=docker.n8n.io/n8nio/n8n:2.42.6
N8N_PORT=5678                                            # bound to 127.0.0.1
PROXY_PORT=4093                                          # logproxy in front of plugboard
PLUGBOARD_PORT="${PLUGBOARD_PORT:-4010}"
DOCKER_HOST_NAME="${DOCKER_HOST_NAME:-host.docker.internal}"
LOGPROXY_HOST="${LOGPROXY_HOST:-127.0.0.1}"
TRAFFIC="$REPO/compat/traffic/n8n.jsonl"
KEY="${PLUGBOARD_KEY:?set PLUGBOARD_KEY}"
N8N="http://127.0.0.1:$N8N_PORT"
# Container -> host: --add-host maps host.docker.internal where Docker does not already provide it.
CRED_URL="http://$DOCKER_HOST_NAME:$PROXY_PORT/v1"
OWNER_EMAIL=compat@example.com
OWNER_PW='Compat-Test-1234'
mkdir -p "$STATE" "$REPO/compat/traffic"

up() {
  # 1. logproxy. A container on Linux cannot reach plugboard on loopback, so LOGPROXY_HOST may need to be the docker bridge
  #    address or 0.0.0.0. Anything that can reach the proxy can reuse the key it forwards: widen it only on a trusted machine.
  if ! curl -fs "http://127.0.0.1:$PROXY_PORT/healthz" >/dev/null; then
    nohup python3 "$REPO/compat/tools/logproxy.py" --host "$LOGPROXY_HOST" --port "$PROXY_PORT" \
      --upstream "http://127.0.0.1:$PLUGBOARD_PORT" --out "$TRAFFIC" \
      >"$STATE/logproxy.log" 2>&1 &
    echo $! >"$STATE/logproxy.pid"
    sleep 1
  fi
  # 2. n8n
  docker pull "$IMAGE"
  docker run -d --name "$CONTAINER" -p "127.0.0.1:$N8N_PORT:5678" \
    --add-host host.docker.internal:host-gateway \
    -e N8N_SECURE_COOKIE=false -e GENERIC_TIMEZONE=UTC \
    -e N8N_DIAGNOSTICS_ENABLED=false -e N8N_PERSONALIZATION_ENABLED=false \
    -v "$VOLUME:/home/node/.n8n" "$IMAGE"
  until curl -fs "$N8N/healthz" >/dev/null; do sleep 2; done
  sleep 5
  # 3. owner (first-run setup endpoint), login, public-API key with workflow/credential/execution scopes
  rm -f "$STATE/cj"
  curl -fs -c "$STATE/cj" -X POST "$N8N/rest/owner/setup" -H 'content-type: application/json' \
    -d "{\"email\":\"$OWNER_EMAIL\",\"firstName\":\"Compat\",\"lastName\":\"Test\",\"password\":\"$OWNER_PW\"}" >/dev/null
  curl -fs -b "$STATE/cj" -c "$STATE/cj" -X POST "$N8N/rest/login" -H 'content-type: application/json' \
    -d "{\"emailOrLdapLoginId\":\"$OWNER_EMAIL\",\"password\":\"$OWNER_PW\"}" >/dev/null
  curl -fs -b "$STATE/cj" -X POST "$N8N/rest/api-keys" -H 'content-type: application/json' \
    -d '{"label":"compat","scopes":["workflow:create","workflow:read","workflow:list","workflow:update","workflow:delete","workflow:activate","workflow:deactivate","credential:create","credential:list","credential:read","credential:update","credential:delete","execution:list","execution:read","execution:delete","execution:stop"],"expiresAt":null}' \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["rawApiKey"])' >"$STATE/apikey"
  chmod 600 "$STATE/apikey"
  # 4. OpenAI credential, custom Base URL -> logproxy -> plugboard
  python3 - "$KEY" "$CRED_URL" >"$STATE/cred.json" <<'EOF'
import json,sys
print(json.dumps({"name":"Plugboard","type":"openAiApi","data":{"apiKey":sys.argv[1],"url":sys.argv[2],"header":False,"allowedHttpRequestDomains":"all"}}))
EOF
  curl -fs -H "X-N8N-API-KEY: $(cat "$STATE/apikey")" -X POST "$N8N/api/v1/credentials" \
    -H 'content-type: application/json' -d @"$STATE/cred.json" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])' >"$STATE/credid"
  # 5. import + activate every workflow (placeholder __CRED_ID__ -> real credential id)
  for f in "$HERE"/s*.json; do
    sed "s/__CRED_ID__/$(cat "$STATE/credid")/" "$f" >"$STATE/wf.json"
    id=$(curl -fs -H "X-N8N-API-KEY: $(cat "$STATE/apikey")" -X POST "$N8N/api/v1/workflows" \
      -H 'content-type: application/json' -d @"$STATE/wf.json" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
    curl -fs -H "X-N8N-API-KEY: $(cat "$STATE/apikey")" -X POST "$N8N/api/v1/workflows/$id/activate" >/dev/null
    echo "imported+activated $(basename "$f") -> $id"
  done
}

mark() { wc -l <"$TRAFFIC" | tr -d ' '; }
# last plugboard exchanges since line $1: method path status + model + stream
since() {
  python3 - "$TRAFFIC" "$1" <<'EOF'
import json,sys
for i,l in enumerate(open(sys.argv[1])):
    if i < int(sys.argv[2]): continue
    d=json.loads(l); r=d.get("req_json") or {}
    print(f"    plugboard: {d['method']} {d['path']} -> {d['status']}  model={r.get('model')} stream={r.get('stream')} keys={sorted(k for k in r if k not in ('messages',))}")
EOF
}
hook() { # hook <workflow-path> <json-body>
  local m; m=$(mark)
  curl -s -m 180 -N -X POST "$N8N/webhook/$1" -H 'content-type: application/json' -d "$2" | head -c 1200; echo
  since "$m"
}

scenarios() {
  local P_PONG='Reply with exactly: pong' P_WX='What is the weather in Paris? Use the tool.' P_MEAL='Estimate: 2 boiled eggs and a slice of toast.'
  local P_JSON='Estimate calories and protein_g as JSON {"calories":number,"protein_g":number} for: 2 boiled eggs and a slice of toast.'
  local IMG; IMG="$(tr -d '\n' <"$REPO/compat/fixtures/red32.dataurl.txt")"
  local MODELS=(fast anthropic/claude-haiku-4-5 'openai/gpt-5.6-luna#low')

  echo "== credential test (n8n calls GET /models)"
  python3 - "$KEY" "$CRED_URL" "$(cat "$STATE/credid")" >"$STATE/credtest.json" <<'EOF'
import json,sys
print(json.dumps({"credentials":{"id":sys.argv[3],"name":"Plugboard","type":"openAiApi","data":{"apiKey":sys.argv[1],"url":sys.argv[2],"header":False,"allowedHttpRequestDomains":"all"}}}))
EOF
  curl -s -b "$STATE/cj" -X POST "$N8N/rest/credentials/test" -H 'content-type: application/json' -d @"$STATE/credtest.json"; echo
  echo "== credential test, wrong key"
  sed 's/"apiKey": *"[^"]*"/"apiKey":"sk-wrong"/' "$STATE/credtest.json" >"$STATE/credbad.json"
  curl -s -b "$STATE/cj" -X POST "$N8N/rest/credentials/test" -H 'content-type: application/json' -d @"$STATE/credbad.json"; echo

  echo "== S7 model dropdown (searchModels -> GET /models), filter fast / claude-haiku / #low"
  for f in fast claude-haiku '#low'; do
    curl -s -b "$STATE/cj" -X POST "$N8N/rest/dynamic-node-parameters/resource-locator-results" -H 'content-type: application/json' \
      -d "{\"path\":\"model\",\"nodeTypeAndVersion\":{\"name\":\"@n8n/n8n-nodes-langchain.lmChatOpenAi\",\"version\":1.3},\"methodName\":\"searchModels\",\"currentNodeParameters\":{\"model\":{\"__rl\":true,\"mode\":\"list\",\"value\":\"\"},\"options\":{}},\"credentials\":{\"openAiApi\":{\"id\":\"$(cat "$STATE/credid")\",\"name\":\"Plugboard\"}},\"filter\":\"$f\"}" \
      | python3 -c "import sys,json; v=[x['value'] for x in json.load(sys.stdin)['data']['results']]; print('filter=$f', len(v), v[:3])"
  done

  echo "== S1 Basic LLM Chain (fast)"
  hook pb-s1-chain "{\"model\":\"fast\",\"prompt\":\"$P_PONG\"}"
  echo "== S1 with Responses API left at the node default (expect 404 /v1/responses)"
  hook pb-s1-responses-default "{\"prompt\":\"$P_PONG\"}"
  echo "== error: model nope (expect 404 model_not_found)"
  hook pb-s1-chain '{"model":"nope","prompt":"hi"}'

  for m in "${MODELS[@]}"; do
    echo "== S2 AI Agent + Code tool, non-stream ($m)"
    hook pb-s2-agent "{\"model\":\"$m\",\"prompt\":\"$P_WX\"}"
  done
  echo "== S3 streaming text via AI Agent + streaming webhook (fast)"
  hook pb-s3s4-stream-agent "{\"model\":\"fast\",\"prompt\":\"$P_PONG\"}"
  echo "== S4 streaming tool call (fast)"
  hook pb-s3s4-stream-agent "{\"model\":\"fast\",\"prompt\":\"$P_WX\"}"

  for m in fast anthropic/claude-haiku-4-5; do
    echo "== S5 image via Basic LLM Chain imageUrl message ($m)"
    python3 -c 'import json,sys; print(json.dumps({"model":sys.argv[1],"prompt":"What color is this image? One word.","image":sys.argv[2]}))' "$m" "$IMG" >"$STATE/s5.json"
    local mk; mk=$(mark)
    curl -s -m 120 -X POST "$N8N/webhook/pb-s5-image" -H 'content-type: application/json' -d @"$STATE/s5.json"; echo
    since "$mk"
  done

  for m in "${MODELS[@]}"; do
    echo "== S6 Structured Output Parser (prompt-injected schema) ($m)"
    hook pb-s6-structured "{\"model\":\"$m\",\"prompt\":\"$P_MEAL\"}"
    echo "== S6b response_format json_object ($m)"
    hook pb-s6b-jsonobject "$(python3 -c 'import json,sys; print(json.dumps({"model":sys.argv[1],"prompt":sys.argv[2]}))' "$m" "$P_JSON")"
  done

  for m in "${MODELS[@]}"; do
    echo "== S8 sampling options temperature+top_p+max_tokens+penalties ($m): n8n sends them only when set in Options"
    hook pb-s8-options "{\"model\":\"$m\",\"prompt\":\"$P_PONG\"}"
  done
  echo "(full exchanges: $TRAFFIC)"
}

down() {
  docker stop "$CONTAINER" >/dev/null 2>&1 || true
  docker rm "$CONTAINER" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
  if [ -f "$STATE/logproxy.pid" ]; then kill "$(cat "$STATE/logproxy.pid")" 2>/dev/null || true; fi
  rm -rf "$STATE"
}

case "${1:-all}" in
  up) up ;;
  scenarios) scenarios ;;
  down) down ;;
  all) up; scenarios; down ;;
  *) echo "usage: $0 up|scenarios|down|all" >&2; exit 2 ;;
esac
