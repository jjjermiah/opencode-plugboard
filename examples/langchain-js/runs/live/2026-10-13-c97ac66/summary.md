# langchain-js · live

Verdict: **partial** · @langchain/openai 1.6.2 on bun 1.4 · models: fast, anthropic/claude-haiku-4-5, openai/gpt-5.6-luna#low, nope
Date: 2026-10-13 · plugboard 0.25.1 (c97ac66)

| Scenario | Model | Required | Status | Checks |
| --- | --- | --- | --- | --- |
| S1 | fast | yes | pass | 3/3 |
| S1 | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S1 | openai/gpt-5.6-luna#low | yes | gap | 2/3 |
| S2 | fast | yes | pass | 6/6 |
| S2 | anthropic/claude-haiku-4-5 | yes | pass | 6/6 |
| S2 | openai/gpt-5.6-luna#low | yes | gap | 4/6 |
| S3 | fast | yes | pass | 4/4 |
| S4 | fast | yes | pass | 4/4 |
| S5 | fast | yes | pass | 1/1 |
| S5 | anthropic/claude-haiku-4-5 | yes | pass | 1/1 |
| S5 | openai/gpt-5.6-luna#low | yes | pass | 1/1 |
| S6 | fast | yes | pass | 3/3 |
| S6 | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S6 | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S7 | - | yes | pass | 3/3 |
| E1 | fast | no | pass | 2/2 |
| E2 | nope | no | pass | 2/2 |

## Failures and gaps

### S1 on openai/gpt-5.6-luna#low: gap

LangChain's Responses path sets no finish_reason; status is completed (#104)

Failed checks: finish_reason is stop

### S2 on openai/gpt-5.6-luna#low: gap

LangChain's Responses path sets no finish_reason; status is completed (#104)

Failed checks: turn 1 finish_reason is tool_calls; turn 2 finish_reason is stop

