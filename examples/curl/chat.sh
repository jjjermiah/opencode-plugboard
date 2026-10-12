#!/usr/bin/env bash
# Chat Completions (POST /v1/chat/completions): S1 plain chat, S2 tool round trip, S3 stream with usage,
# S4 streaming tool call, S5 image, S6 structured output, E1 wrong key, E2 unknown model.
#
# Run one scenario on its own:   bash chat.sh S1 fast
# Needs curl and jq. PLUGBOARD_BASE_URL ends in /v1 (for example http://127.0.0.1:4010/v1); PLUGBOARD_KEY is an app key.
set -u -o pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
SHARED="$HERE/../_shared"

# region snippet
post() { # $1 = JSON body
  curl -sS -f "$PLUGBOARD_BASE_URL/chat/completions" \
    -H "Authorization: Bearer $PLUGBOARD_KEY" -H "Content-Type: application/json" -d "$1"
}
# endregion snippet

s1() { # plain chat, non-stream
  local out
  # region snippet
  out=$(post "$(jq -cn --arg m "$1" '{model: $m, messages: [{role: "user", content: "Reply with exactly: pong"}]}')")
  # endregion snippet
  jq -c '{text: (.choices[0].message.content // ""), finish_reason: .choices[0].finish_reason, usage: .usage}' <<<"$out"
}

s2() { # tool call, then the tool result turn
  local model=$1 tool body out1 out2 call_id args
  tool=$(jq -c '.' "$SHARED/get_weather.tool.json")
  # region snippet
  body=$(jq -cn --arg m "$model" --argjson tool "$tool" \
    '{model: $m, messages: [{role: "user", content: "What is the weather in Paris? Use the tool."}], tools: [$tool]}')
  out1=$(post "$body")
  call_id=$(jq -r '.choices[0].message.tool_calls[0].id // ""' <<<"$out1")
  args=$(jq -r '.choices[0].message.tool_calls[0].function.arguments // "{}"' <<<"$out1")
  # The assistant message goes back as the model sent it, then the tool result with the same call id.
  body=$(jq -cn --arg m "$model" --argjson tool "$tool" --argjson turn1 "$(jq -c '.choices[0].message' <<<"$out1")" \
    --arg id "$call_id" --rawfile result "$SHARED/get_weather.result.json" \
    '{model: $m, tools: [$tool], messages: [{role: "user", content: "What is the weather in Paris? Use the tool."}, $turn1, {role: "tool", tool_call_id: $id, content: $result}]}')
  out2=$(post "$body")
  # endregion snippet
  jq -cn --argjson one "$out1" --argjson two "$out2" --arg args "$args" --arg id "$call_id" '{
    finish_reason: $one.choices[0].finish_reason,
    tool_name: ($one.choices[0].message.tool_calls[0].function.name // ""),
    tool_city: ($args | fromjson | .city // ""),
    tool_call_id: $id,
    final_text: ($two.choices[0].message.content // ""),
    final_finish_reason: $two.choices[0].finish_reason
  }'
}

s3() { # streaming text, with include_usage
  local out frames
  # region snippet
  out=$(curl -sS -N "$PLUGBOARD_BASE_URL/chat/completions" -H "Authorization: Bearer $PLUGBOARD_KEY" -H "Content-Type: application/json" \
    -d "$(jq -cn --arg m "$1" '{model: $m, stream: true, stream_options: {include_usage: true}, messages: [{role: "user", content: "Reply with exactly: pong"}]}')")
  # endregion snippet
  frames=$(grep '^data: ' <<<"$out" | sed 's/^data: //' | grep -v '^\[DONE\]$' || true)
  jq -cn --arg text "$(jq -rs '[.[] | .choices[]?.delta.content // empty] | join("")' <<<"$frames")" \
    --arg finish "$(jq -rs '[.[] | .choices[]?.finish_reason // empty] | last // ""' <<<"$frames")" \
    --argjson usage "$(jq -s '[.[] | .usage // empty] | last // null' <<<"$frames")" \
    --argjson done "$(grep -q '^data: \[DONE\]$' <<<"$out" && echo true || echo false)" \
    '{text: $text, finish_reason: $finish, usage: $usage, done: $done}'
}

s4() { # streaming tool call: the name and id arrive in one delta, the arguments in one more
  local out frames args
  out=$(curl -sS -N "$PLUGBOARD_BASE_URL/chat/completions" -H "Authorization: Bearer $PLUGBOARD_KEY" -H "Content-Type: application/json" \
    -d "$(jq -cn --arg m "$1" --argjson tool "$(jq -c '.' "$SHARED/get_weather.tool.json")" \
      '{model: $m, stream: true, tools: [$tool], messages: [{role: "user", content: "What is the weather in Paris? Use the tool."}]}')")
  frames=$(grep '^data: ' <<<"$out" | sed 's/^data: //' | grep -v '^\[DONE\]$' || true)
  # Accumulate the arguments: clients must concatenate them whether the server sends one delta or many.
  args=$(jq -rs '[.[] | .choices[]?.delta.tool_calls[]? | .function.arguments // ""] | join("")' <<<"$frames")
  jq -cn --arg args "$args" \
    --arg name "$(jq -rs '[.[] | .choices[]?.delta.tool_calls[]? | select(.function.name) | .function.name] | first // ""' <<<"$frames")" \
    --arg id "$(jq -rs '[.[] | .choices[]?.delta.tool_calls[]? | select(.id) | .id] | first // ""' <<<"$frames")" \
    --arg finish "$(jq -rs '[.[] | .choices[]?.finish_reason // empty] | last // ""' <<<"$frames")" \
    '{finish_reason: $finish, tool_name: $name, tool_city: ($args | fromjson | .city // ""), tool_call_id: $id}'
}

s5() { # image as a data URL
  local url out
  url=$(tr -d '\n' <"$SHARED/red32.dataurl.txt")
  # region snippet
  out=$(post "$(jq -cn --arg m "$1" --arg url "$url" '{model: $m, messages: [{role: "user", content: [
    {type: "text", text: "What color is this image? One word."},
    {type: "image_url", image_url: {url: $url}}]}]}')")
  # endregion snippet
  jq -c '{text: (.choices[0].message.content // "")}' <<<"$out"
}

s6() { # structured output: response_format json_schema
  local out content
  out=$(post "$(jq -cn --arg m "$1" --argjson schema "$(jq -c '.' "$SHARED/meal_estimate.json_schema.json")" \
    '{model: $m, messages: [{role: "user", content: "Estimate: 2 boiled eggs and a slice of toast."}], response_format: {type: "json_schema", json_schema: $schema}}')")
  content=$(jq -r '.choices[0].message.content // ""' <<<"$out")
  printf '%s' "$content" | jq -c '{calories: .calories, protein_g: .protein_g, extra_keys: (keys - ["calories", "protein_g"])}'
}

e1() { # wrong key: 401 invalid_api_key
  local resp status
  resp=$(mktemp)
  status=$(curl -s -o "$resp" -w '%{http_code}' "$PLUGBOARD_BASE_URL/chat/completions" \
    -H "Authorization: Bearer sk-wrong-key-example" -H "Content-Type: application/json" \
    -d "$(jq -cn --arg m "$1" '{model: $m, messages: [{role: "user", content: "Reply with exactly: pong"}]}')")
  jq -c --argjson status "$status" '{status: $status, code: .error.code}' "$resp"
  rm -f "$resp"
}

e2() { # unknown model: 404 model_not_found
  local resp status
  resp=$(mktemp)
  status=$(curl -s -o "$resp" -w '%{http_code}' "$PLUGBOARD_BASE_URL/chat/completions" -H "Authorization: Bearer $PLUGBOARD_KEY" -H "Content-Type: application/json" \
    -d "$(jq -cn --arg m "$1" '{model: $m, messages: [{role: "user", content: "Reply with exactly: pong"}]}')")
  jq -c --argjson status "$status" '{status: $status, code: .error.code}' "$resp"
  rm -f "$resp"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  scenario=${1:?usage: chat.sh <scenario> <model>}
  model=${2:?usage: chat.sh <scenario> <model>}
  case "$scenario" in
    S1) s1 "$model" ;;
    S2) s2 "$model" ;;
    S3) s3 "$model" ;;
    S4) s4 "$model" ;;
    S5) s5 "$model" ;;
    S6) s6 "$model" ;;
    E1) e1 "$model" ;;
    E2) e2 "$model" ;;
    *) echo "chat.sh does not cover $scenario" >&2; exit 2 ;;
  esac
fi
