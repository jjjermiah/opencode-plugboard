#!/usr/bin/env bash
# Gemini (POST /v1beta/models/<model>:generateContent, key in x-goog-api-key): S1 plain chat, S2 function call
# round trip, S3 streamed text. The route lives at the origin, so PLUGBOARD_BASE_URL's /v1 is stripped.
#
# Run one scenario on its own:   bash gemini.sh S1 fast
# Needs curl and jq. PLUGBOARD_BASE_URL ends in /v1; PLUGBOARD_KEY is an app key.
set -u -o pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
SHARED="$HERE/../_shared"
ORIGIN=${PLUGBOARD_BASE_URL%/v1}

# region snippet
post() { # $1 = model id, $2 = JSON body; the model goes in the path, percent-encoded
  curl -sS -f "$ORIGIN/v1beta/models/$(jq -rn --arg m "$1" '$m | @uri'):generateContent" \
    -H "x-goog-api-key: $PLUGBOARD_KEY" -H "Content-Type: application/json" -d "$2"
}
# endregion snippet

s1() { # plain chat
  local out
  # region snippet
  out=$(post "$1" '{"contents": [{"parts": [{"text": "Reply with exactly: pong"}]}]}')
  # endregion snippet
  jq -c '{text: ([.candidates[0].content.parts[]?.text] | join("")), finish_reason: (if .candidates[0].finishReason == "STOP" then "stop" else (.candidates[0].finishReason // "") end), usage: .usageMetadata}' <<<"$out"
}

s2() { # function call, then the functionResponse turn
  local model=$1 decls out1 out2 call args
  decls=$(jq -c '{functionDeclarations: [{name: .function.name, description: .function.description, parameters: .function.parameters}]}' "$SHARED/get_weather.tool.json")
  # region snippet
  out1=$(post "$model" "$(jq -cn --argjson tools "[$decls]" '{tools: $tools, contents: [{role: "user", parts: [{text: "What is the weather in Paris? Use the tool."}]}]}')")
  call=$(jq -c '[.candidates[0].content.parts[]? | select(.functionCall) | .functionCall][0] // {}' <<<"$out1")
  out2=$(post "$model" "$(jq -cn --argjson tools "[$decls]" --argjson turn1 "$(jq -c '.candidates[0].content' <<<"$out1")" \
    --argjson result "$(jq -c '.' "$SHARED/get_weather.result.json")" --arg name "$(jq -r '.name // "get_weather"' <<<"$call")" \
    '{tools: $tools, contents: [
      {role: "user", parts: [{text: "What is the weather in Paris? Use the tool."}]},
      $turn1,
      {role: "user", parts: [{functionResponse: {name: $name, response: $result}}]}]}')")
  # endregion snippet
  jq -cn --argjson one "$out1" --argjson two "$out2" --argjson call "$call" '{
    finish_reason: (if ($call | has("name")) then "tool_calls" else ($one.candidates[0].finishReason // "") end),
    tool_name: ($call.name // ""),
    tool_city: ($call.args.city // ""),
    tool_call_id: ($call.name // ""),
    final_text: ([$two.candidates[0].content.parts[]?.text] | join("")),
    final_finish_reason: (if $two.candidates[0].finishReason == "STOP" then "stop" else ($two.candidates[0].finishReason // "") end)
  }'
}

s3() { # streamed text: each SSE frame is a GenerateContentResponse
  local out frames
  # region snippet
  out=$(curl -sS -N "$ORIGIN/v1beta/models/$(jq -rn --arg m "$1" '$m | @uri'):streamGenerateContent?alt=sse" \
    -H "x-goog-api-key: $PLUGBOARD_KEY" -H "Content-Type: application/json" \
    -d '{"contents": [{"parts": [{"text": "Reply with exactly: pong"}]}]}')
  # endregion snippet
  frames=$(grep '^data: ' <<<"$out" | sed 's/^data: //' || true)
  jq -cn --arg text "$(jq -rs '[.[] | .candidates[0].content.parts[]?.text] | join("")' <<<"$frames")" \
    --arg finish "$(jq -rs '[.[] | .candidates[0].finishReason // empty] | last // ""' <<<"$frames" | sed 's/^STOP$/stop/')" \
    --argjson usage "$(jq -s '[.[] | .usageMetadata // empty] | last // null' <<<"$frames")" \
    '{text: $text, finish_reason: $finish, usage: $usage, done: ($finish != "")}'
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  scenario=${1:?usage: gemini.sh <scenario> <model>}
  model=${2:?usage: gemini.sh <scenario> <model>}
  case "$scenario" in
    S1) s1 "$model" ;;
    S2) s2 "$model" ;;
    S3) s3 "$model" ;;
    *) echo "gemini.sh does not cover $scenario" >&2; exit 2 ;;
  esac
fi
