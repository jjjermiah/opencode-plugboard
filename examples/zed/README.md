# Zed with plugboard

A Zed `settings.json` fragment with one OpenAI-compatible provider and one Anthropic-compatible provider. The client guide is [docs/clients/zed.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/clients/zed.md), which has the plugboard options (app `zed`) and the UI path.

- `settings.json`: merge the `language_models` block into Zed's `settings.json`. It holds no keys. Set each key in the provider's settings UI, or in the variable Zed derives from the provider name (`PLUGBOARD_API_KEY` and `PLUGBOARD_ANTHROPIC_API_KEY`).

Not run against plugboard yet.
