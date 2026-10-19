# Source this file, then run `claude`:  . env.sh
# Needs PLUGBOARD_KEY_CLAUDE_CODE set to the app key from the plugboard `keys` option.
# region snippet
export ANTHROPIC_BASE_URL="http://127.0.0.1:4010"
export ANTHROPIC_AUTH_TOKEN="$PLUGBOARD_KEY_CLAUDE_CODE"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="fast"
export ANTHROPIC_DEFAULT_SONNET_MODEL="smart"
export ANTHROPIC_DEFAULT_OPUS_MODEL="smart"
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
# endregion snippet
