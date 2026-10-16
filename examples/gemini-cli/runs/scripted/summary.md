# gemini-cli · scripted

Verdict: **pass** · @google/gemini-cli 0.64.0 on bun 1 · models: fast, anthropic/claude-haiku-4-5, openai/gpt-5.6-luna#low, nope

| Scenario | Model | Required | Status | Checks |
| --- | --- | --- | --- | --- |
| S1 | fast | yes | pass | 2/2 |
| S1 | anthropic/claude-haiku-4-5 | yes | pass | 2/2 |
| S1 | openai/gpt-5.6-luna#low | yes | pass | 2/2 |
| S2 | fast | yes | n/a |  |
| S2 | anthropic/claude-haiku-4-5 | yes | n/a |  |
| S2 | openai/gpt-5.6-luna#low | yes | n/a |  |
| S3 | fast | yes | pass | 3/3 |
| S4 | fast | yes | n/a |  |
| S5 | fast | yes | n/a |  |
| S5 | anthropic/claude-haiku-4-5 | yes | n/a |  |
| S5 | openai/gpt-5.6-luna#low | yes | n/a |  |
| S6 | fast | yes | n/a |  |
| S6 | anthropic/claude-haiku-4-5 | yes | n/a |  |
| S6 | openai/gpt-5.6-luna#low | yes | n/a |  |
| S7 | - | yes | n/a |  |
| E1 | fast | no | n/a |  |
| E2 | nope | no | n/a |  |

## Failures, gaps and unchecked items

### S1 on fast: pass

not checked, finish_reason is stop: the CLI's output carries no finish reason; the status is recorded as success or error

### S1 on anthropic/claude-haiku-4-5: pass

not checked, finish_reason is stop: the CLI's output carries no finish reason; the status is recorded as success or error

### S1 on openai/gpt-5.6-luna#low: pass

not checked, finish_reason is stop: the CLI's output carries no finish reason; the status is recorded as success or error

### S3 on fast: pass

not checked, finish_reason is stop: the CLI's output carries no finish reason; the status is recorded as success or error

