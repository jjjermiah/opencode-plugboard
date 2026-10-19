# autogen · scripted

Verdict: **pass** · autogen 0.14.1 on python 3 · models: fast, anthropic/claude-haiku-4-5, openai/gpt-5.6-luna#low

| Scenario | Model | Required | Status | Checks |
| --- | --- | --- | --- | --- |
| S1 (chat) | fast | yes | pass | 2/2 |
| S1 (messages) | fast | yes | pass | 2/2 |
| S1 (chat) | anthropic/claude-haiku-4-5 | yes | pass | 2/2 |
| S1 (messages) | anthropic/claude-haiku-4-5 | yes | pass | 2/2 |
| S1 (chat) | openai/gpt-5.6-luna#low | yes | pass | 2/2 |
| S1 (messages) | openai/gpt-5.6-luna#low | yes | pass | 2/2 |
| S2 (chat) | fast | yes | pass | 4/4 |
| S2 (messages) | fast | yes | pass | 4/4 |
| S2 (chat) | anthropic/claude-haiku-4-5 | yes | pass | 4/4 |
| S2 (messages) | anthropic/claude-haiku-4-5 | yes | pass | 4/4 |
| S2 (chat) | openai/gpt-5.6-luna#low | yes | pass | 4/4 |
| S2 (messages) | openai/gpt-5.6-luna#low | yes | pass | 4/4 |
| S3 (chat) | fast | yes | pass | 2/2 |

## Failures, gaps and unchecked items

### S1 (chat) on fast: pass

not checked, finish_reason is stop: AutoGen returns the reply text, not the finish reason

### S1 (messages) on fast: pass

not checked, finish_reason is stop: AutoGen returns the reply text, not the finish reason

### S1 (chat) on anthropic/claude-haiku-4-5: pass

not checked, finish_reason is stop: AutoGen returns the reply text, not the finish reason

### S1 (messages) on anthropic/claude-haiku-4-5: pass

not checked, finish_reason is stop: AutoGen returns the reply text, not the finish reason

### S1 (chat) on openai/gpt-5.6-luna#low: pass

not checked, finish_reason is stop: AutoGen returns the reply text, not the finish reason

### S1 (messages) on openai/gpt-5.6-luna#low: pass

not checked, finish_reason is stop: AutoGen returns the reply text, not the finish reason

### S2 (chat) on fast: pass

not checked, turn 1 finish_reason is tool_calls: AutoGen returns the reply text, not the finish reason; not checked, turn 2 finish_reason is stop: AutoGen returns the reply text, not the finish reason

### S2 (messages) on fast: pass

not checked, turn 1 finish_reason is tool_calls: AutoGen returns the reply text, not the finish reason; not checked, turn 2 finish_reason is stop: AutoGen returns the reply text, not the finish reason

### S2 (chat) on anthropic/claude-haiku-4-5: pass

not checked, turn 1 finish_reason is tool_calls: AutoGen returns the reply text, not the finish reason; not checked, turn 2 finish_reason is stop: AutoGen returns the reply text, not the finish reason

### S2 (messages) on anthropic/claude-haiku-4-5: pass

not checked, turn 1 finish_reason is tool_calls: AutoGen returns the reply text, not the finish reason; not checked, turn 2 finish_reason is stop: AutoGen returns the reply text, not the finish reason

### S2 (chat) on openai/gpt-5.6-luna#low: pass

not checked, turn 1 finish_reason is tool_calls: AutoGen returns the reply text, not the finish reason; not checked, turn 2 finish_reason is stop: AutoGen returns the reply text, not the finish reason

### S2 (messages) on openai/gpt-5.6-luna#low: pass

not checked, turn 1 finish_reason is tool_calls: AutoGen returns the reply text, not the finish reason; not checked, turn 2 finish_reason is stop: AutoGen returns the reply text, not the finish reason

### S3 (chat) on fast: pass

not checked, finish_reason is stop: AutoGen returns the reply text, not the finish reason; not checked, usage chunk present when requested: AutoGen returns no usage for a streamed reply

