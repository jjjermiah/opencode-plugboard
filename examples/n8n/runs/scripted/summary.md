# n8n · scripted

Verdict: **pass** · n8n 2.42.6 on bun 1 · models: fast, anthropic/claude-haiku-4-5, openai/gpt-5.6-luna#low, nope

| Scenario | Model | Required | Status | Checks |
| --- | --- | --- | --- | --- |
| S1 (chat) | fast | yes | pass | 3/3 |
| S1 (responses) | fast | yes | pass | 2/2 |
| S1 (chat) | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S1 (responses) | anthropic/claude-haiku-4-5 | yes | pass | 2/2 |
| S1 (chat) | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S1 (responses) | openai/gpt-5.6-luna#low | yes | pass | 2/2 |
| S2 | fast | yes | pass | 6/6 |
| S2 | anthropic/claude-haiku-4-5 | yes | pass | 6/6 |
| S2 | openai/gpt-5.6-luna#low | yes | pass | 6/6 |
| S3 | fast | yes | pass | 4/4 |
| S4 | fast | yes | pass | 4/4 |
| S5 | fast | yes | pass | 1/1 |
| S5 | anthropic/claude-haiku-4-5 | yes | pass | 1/1 |
| S5 | openai/gpt-5.6-luna#low | yes | pass | 1/1 |
| S6 | fast | yes | pass | 3/3 |
| S6 | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S6 | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S7 | - | yes | pass | 3/3 |
| E1 | fast | no | n/a |  |
| E2 | nope | no | n/a |  |

## Failures and gaps

### S1 (responses) on fast: pass

not checked, finish_reason is stop: n8n's Responses node records no finish_reason (#343)

### S1 (responses) on anthropic/claude-haiku-4-5: pass

not checked, finish_reason is stop: n8n's Responses node records no finish_reason (#343)

### S1 (responses) on openai/gpt-5.6-luna#low: pass

not checked, finish_reason is stop: n8n's Responses node records no finish_reason (#343)

