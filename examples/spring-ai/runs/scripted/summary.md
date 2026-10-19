# spring-ai · scripted

Verdict: **pass** · spring-ai 2.0.1 on java 21 · models: fast, anthropic/claude-haiku-4-5, openai/gpt-5.6-luna#low

| Scenario | Model | Required | Status | Checks |
| --- | --- | --- | --- | --- |
| S1 | fast | yes | pass | 3/3 |
| S1 | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S1 | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S2 | fast | yes | pass | 4/4 |
| S2 | anthropic/claude-haiku-4-5 | yes | pass | 4/4 |
| S2 | openai/gpt-5.6-luna#low | yes | pass | 4/4 |
| S3 | fast | yes | pass | 4/4 |

## Failures, gaps and unchecked items

### S2 on fast: pass

not checked, call id present: the tool is run inside Spring AI, so the call id is not returned; not checked, turn 1 finish_reason is tool_calls: the tool is run inside Spring AI, so the first turn's finish reason is not returned

### S2 on anthropic/claude-haiku-4-5: pass

not checked, call id present: the tool is run inside Spring AI, so the call id is not returned; not checked, turn 1 finish_reason is tool_calls: the tool is run inside Spring AI, so the first turn's finish reason is not returned

### S2 on openai/gpt-5.6-luna#low: pass

not checked, call id present: the tool is run inside Spring AI, so the call id is not returned; not checked, turn 1 finish_reason is tool_calls: the tool is run inside Spring AI, so the first turn's finish reason is not returned

