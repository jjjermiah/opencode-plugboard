# <client name> against plugboard

- Date / tester:
- Client + exact version(s) (and adapter packages):
- Env: compat/py | compat/js | docker (image + tag)
- Plugboard commit (`git -C <repo> rev-parse --short HEAD`):
- Verdict (README gate = S1 and S2 pass): PASS | FAIL | PARTIAL

## Scenarios

| # | Scenario | Model | Result (pass/fail/n.a.) | Notes |
|---|---|---|---|---|
| S1 | plain chat | fast | | |
| S2 | tool call + tool-result turn | fast | | |
| S2 | same | anthropic/claude-haiku-4-5 | | |
| S2 | same | openai/gpt-5.6-luna#low | | |
| S3 | streaming text (+ include_usage) | fast | | |
| S4 | streaming tool call | fast | | |
| S5 | image data URL | fast | | |
| S5 | same | anthropic/claude-haiku-4-5 | | |
| S6 | structured output | fast | | |
| S6 | same | anthropic/claude-haiku-4-5 | | |
| S6 | same | openai/gpt-5.6-luna#low | | |
| S7 | list models | n/a | | |

## Failures (exact error text)

## Suspected plugboard bugs

For each: suspected cause (plugboard bug / client quirk / model behaviour), the raw request, the raw response, time of occurrence.

## What the client actually sends (notable fields)

e.g. `max_tokens` vs `max_completion_tokens`, `developer` role, `stream_options`, `parallel_tool_calls`, `tool_choice`, extra fields.

## Notes / follow-ups

Scripts committed under: `compat/py/<client>/` or `compat/js/<client>/`
