# tool-bot · scripted

Verdict: **partial** · openai 7.32.0 on bun 1 · models: fast, anthropic/claude-haiku-4-5, openai/gpt-5.6-luna#low

| Scenario | Model | Required | Status | Checks |
| --- | --- | --- | --- | --- |
| S2 | fast | yes | gap | 1/6 |
| S2 | anthropic/claude-haiku-4-5 | yes | gap | 1/6 |
| S2 | openai/gpt-5.6-luna#low | yes | gap | 1/6 |

## Failures and gaps

### S2 on fast: gap

the bot prints only its final answer, so the tool-call checks cannot be read from its output (#320)

Failed checks: turn 1 finish_reason is tool_calls; one get_weather call; city is Paris; call id present; turn 2 finish_reason is stop

### S2 on anthropic/claude-haiku-4-5: gap

the bot prints only its final answer, so the tool-call checks cannot be read from its output (#320)

Failed checks: turn 1 finish_reason is tool_calls; one get_weather call; city is Paris; call id present; turn 2 finish_reason is stop

### S2 on openai/gpt-5.6-luna#low: gap

the bot prints only its final answer, so the tool-call checks cannot be read from its output (#320)

Failed checks: turn 1 finish_reason is tool_calls; one get_weather call; city is Paris; call id present; turn 2 finish_reason is stop

