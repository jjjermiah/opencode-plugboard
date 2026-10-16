# langchain-js · scripted

Verdict: **pass** · @langchain/openai 1.6.2 on bun 1 · models: fast, anthropic/claude-haiku-4-5, openai/gpt-5.6-luna#low, nope

| Scenario | Model | Required | Status | Checks |
| --- | --- | --- | --- | --- |
| S1 (chat) | fast | yes | pass | 3/3 |
| S1 (auto) | fast | yes | pass | 2/2 |
| S1 (chat) | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S1 (auto) | anthropic/claude-haiku-4-5 | yes | pass | 2/2 |
| S1 (chat) | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S1 (auto) | openai/gpt-5.6-luna#low | yes | pass | 2/2 |
| S2 (chat) | fast | yes | pass | 6/6 |
| S2 (auto) | fast | yes | pass | 4/4 |
| S2 (chat) | anthropic/claude-haiku-4-5 | yes | pass | 6/6 |
| S2 (auto) | anthropic/claude-haiku-4-5 | yes | pass | 4/4 |
| S2 (chat) | openai/gpt-5.6-luna#low | yes | pass | 6/6 |
| S2 (auto) | openai/gpt-5.6-luna#low | yes | pass | 4/4 |
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

## Failures, gaps and unchecked items

### S1 (auto) on fast: pass

not checked, finish_reason is stop: LangChain exposes no finish_reason on the Responses route (plugboard returns status completed)

### S1 (auto) on anthropic/claude-haiku-4-5: pass

not checked, finish_reason is stop: LangChain exposes no finish_reason on the Responses route (plugboard returns status completed)

### S1 (auto) on openai/gpt-5.6-luna#low: pass

not checked, finish_reason is stop: LangChain exposes no finish_reason on the Responses route (plugboard returns status completed)

### S2 (auto) on fast: pass

not checked, turn 1 finish_reason is tool_calls: LangChain exposes no finish_reason on the Responses route (plugboard returns status completed); not checked, turn 2 finish_reason is stop: LangChain exposes no finish_reason on the Responses route (plugboard returns status completed)

### S2 (auto) on anthropic/claude-haiku-4-5: pass

not checked, turn 1 finish_reason is tool_calls: LangChain exposes no finish_reason on the Responses route (plugboard returns status completed); not checked, turn 2 finish_reason is stop: LangChain exposes no finish_reason on the Responses route (plugboard returns status completed)

### S2 (auto) on openai/gpt-5.6-luna#low: pass

not checked, turn 1 finish_reason is tool_calls: LangChain exposes no finish_reason on the Responses route (plugboard returns status completed); not checked, turn 2 finish_reason is stop: LangChain exposes no finish_reason on the Responses route (plugboard returns status completed)

