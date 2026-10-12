#!/usr/bin/env bash
# Anthropic Messages (POST /v1/messages), key in x-api-key: S1 plain chat, S2 tool round trip, S3 stream with usage.
#
# Run one scenario on its own:   bash messages.sh S1 anthropic/claude-haiku-4-5
# Needs curl and jq. PLUGBOARD_BASE_URL ends in /v1; PLUGBOARD_KEY is an app key.
set -u -o pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
SHARED="$HERE/../_shared"

# region snippet
post() { # $1 = JSON body
  curl -sS -f "$PLUGBOARD_BASE_URL/messages" \
    -H "x-api-key: $PLUGBOARD_KEY" -H "anthropic-version: 2023-06-01" -H "Content-Type: application/json" -d "$1"
}
# endregion snippet

s1() { # plain chat, non-stream
  local out
  # region snippet
  out=$(post "$(jq -cn --arg m "$1" '{model: $m, max_tokens: 1024, messages: [{role: "user", content: "Reply with exactly: pong"}]}')")
  # endregion snippet
  jq -c '{text: ([.content[] | select(.type == "text") | .text] | join("")), finish_reason: (if .stop_reason == "end_turn" then "stop" else .stop_reason end), usage: .usage}' <<<"$out"
}

s2() { # tool use, then the tool_result turn
  local model=$1 tools out1 out2 use_id args
  # Anthropic takes the same tool as name, description and input_schema.
  tools=$(jq -c '[{name: .function.name, description: .function.description, input_schema: .function.parameters}]' "$SHARED/get_weather.tool.json")
  # region snippet
  out1=$(post "$(jq -cn --arg m "$model" --argjson tools "$tools" \
    '{model: $m, max_tokens: 1024, tools: $tools, messages: [{role: "user", content: "What is the weather in Paris? Use the tool."}]}')")
  use_id=$(jq -r '[.content[] | select(.type == "tool_use") | .id][0] // ""' <<<"$out1")
  args=$(jq -c '[.content[] | select(.type == "tool_use") | .input][0] // {}' <<<"$out1")
  out2=$(post "$(jq -cn --arg m "$model" --argjson tools "$tools" --argjson turn1 "$(jq -c '.content' <<<"$out1")" \
    --arg id "$use_id" --rawfile result "$SHARED/get_weather.result.json" \
    '{model: $m, max_tokens: 1024, tools: $tools, messages: [
      {role: "user", content: "What is the weather in Paris? Use the tool."},
      {role: "assistant", content: $turn1},
      {role: "user", content: [{type: "tool_result", tool_use_id: $id, content: $result}]}]}')")
  # endregion snippet
  jq -cn --argjson one "$out1" --argjson two "$out2" --argjson args "$args" --arg id "$use_id" '{
    finish_reason: (if $one.stop_reason == "tool_use" then "tool_calls" else $one.stop_reason end),
    tool_name: ([$one.content[] | select(.type == "tool_use") | .name][0] // ""),
    tool_city: ($args.city // ""),
    tool_call_id: $id,
    final_text: ([$two.content[] | select(.type == "text") | .text] | join("")),
    final_finish_reason: (if $two.stop_reason == "end_turn" then "stop" else $two.stop_reason end)
  }'
}

s3() { # streaming text: content_block_delta frames, usage on message_delta
  local out events
  # region snippet
  out=$(curl -sS -N "$PLUGBOARD_BASE_URL/messages" -H "x-api-key: $PLUGBOARD_KEY" -H "anthropic-version: 2023-06-01" -H "Content-Type: application/json" \
    -d "$(jq -cn --arg m "$1" '{model: $m, max_tokens: 1024, stream: true, messages: [{role: "user", content: "Reply with exactly: pong"}]}')")
  # endregion snippet
  events=$(grep '^data: ' <<<"$out" | sed 's/^data: //' || true)
  jq -cn --arg text "$(jq -rs '[.[] | select(.type == "content_block_delta" and .delta.type == "text_delta") | .delta.text] | join("")' <<<"$events")" \
    --arg finish "$(jq -rs '[.[] | select(.type == "message_delta") | .delta.stop_reason] | last // ""' <<<"$events" | sed 's/^end_turn$/stop/')" \
    --argjson usage "$(jq -s '[.[] | select(.type == "message_delta") | .usage] | last // null' <<<"$events")" \
    --argjson done "$(grep -q '"type":"message_stop"\|"type": "message_stop"' <<<"$events" && echo true || echo false)" \
    '{text: $text, finish_reason: $finish, usage: $usage, done: $done}'
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  scenario=${1:?usage: messages.sh <scenario> <model>}
  model=${2:?usage: messages.sh <scenario> <model>}
  case "$scenario" in
    S1) s1 "$model" ;;
    S2) s2 "$model" ;;
    S3) s3 "$model" ;;
    *) echo "messages.sh does not cover $scenario" >&2; exit 2 ;;
  esac
fi
