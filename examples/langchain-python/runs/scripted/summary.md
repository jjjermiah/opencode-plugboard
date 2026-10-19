# langchain-python · scripted

Verdict: **pass** · langchain-openai 1.7.2 on python 3 · models: fast, anthropic/claude-haiku-4-5, openai/gpt-5.6-luna#low, nope

| Scenario | Model | Required | Status | Checks |
| --- | --- | --- | --- | --- |
| S1 (chat) | fast | yes | pass | 3/3 |
| S1 (responses) | fast | yes | pass | 2/2 |
| S1 (chat) | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S1 (responses) | anthropic/claude-haiku-4-5 | yes | pass | 2/2 |
| S1 (chat) | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S1 (responses) | openai/gpt-5.6-luna#low | yes | pass | 2/2 |
| S2 (chat) | fast | yes | pass | 6/6 |
| S2 (responses) | fast | yes | pass | 4/4 |
| S2 (chat) | anthropic/claude-haiku-4-5 | yes | pass | 6/6 |
| S2 (responses) | anthropic/claude-haiku-4-5 | yes | pass | 4/4 |
| S2 (chat) | openai/gpt-5.6-luna#low | yes | pass | 6/6 |
| S2 (responses) | openai/gpt-5.6-luna#low | yes | pass | 4/4 |
| S3 (chat) | fast | yes | pass | 4/4 |
| S3 (responses) | fast | yes | pass | 3/3 |
| S4 | fast | yes | pass | 4/4 |
| S5 (chat) | fast | yes | pass | 1/1 |
| S5 (responses) | fast | yes | pass | 1/1 |
| S5 (chat) | anthropic/claude-haiku-4-5 | yes | pass | 1/1 |
| S5 (responses) | anthropic/claude-haiku-4-5 | yes | pass | 1/1 |
| S5 (chat) | openai/gpt-5.6-luna#low | yes | pass | 1/1 |
| S5 (responses) | openai/gpt-5.6-luna#low | yes | pass | 1/1 |
| S6 (chat) | fast | yes | pass | 3/3 |
| S6 (responses) | fast | yes | pass | 3/3 |
| S6 (chat) | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S6 (responses) | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S6 (chat) | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S6 (responses) | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S7 | - | yes | pass | 3/3 |
| E1 | fast | no | pass | 3/3 |
| E2 | nope | no | pass | 3/3 |

## Failures, gaps and unchecked items

### S1 (responses) on fast: pass

not checked, finish_reason is stop: LangChain exposes no finish_reason on the Responses route (plugboard returns status completed)

### S1 (responses) on anthropic/claude-haiku-4-5: pass

not checked, finish_reason is stop: LangChain exposes no finish_reason on the Responses route (plugboard returns status completed)

### S1 (responses) on openai/gpt-5.6-luna#low: pass

not checked, finish_reason is stop: LangChain exposes no finish_reason on the Responses route (plugboard returns status completed)

### S2 (responses) on fast: pass

not checked, turn 1 finish_reason is tool_calls: LangChain exposes no finish_reason on the Responses route (plugboard returns status completed); not checked, turn 2 finish_reason is stop: LangChain exposes no finish_reason on the Responses route (plugboard returns status completed)

### S2 (responses) on anthropic/claude-haiku-4-5: pass

not checked, turn 1 finish_reason is tool_calls: LangChain exposes no finish_reason on the Responses route (plugboard returns status completed); not checked, turn 2 finish_reason is stop: LangChain exposes no finish_reason on the Responses route (plugboard returns status completed)

### S2 (responses) on openai/gpt-5.6-luna#low: pass

not checked, turn 1 finish_reason is tool_calls: LangChain exposes no finish_reason on the Responses route (plugboard returns status completed); not checked, turn 2 finish_reason is stop: LangChain exposes no finish_reason on the Responses route (plugboard returns status completed)

### S3 (responses) on fast: pass

not checked, finish_reason is stop: LangChain exposes no finish_reason on the Responses route (plugboard returns status completed)

