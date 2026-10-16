# llamaindex · live

Verdict: **pass** · llama-index-llms-openai-like 0.8.1 on python 3 · models: fast, anthropic/claude-haiku-4-5, openai/gpt-5.6-luna#low
Date: 2026-10-16 · plugboard 0.41.0 (9852300) · OpenCode 2.0.29

| Scenario | Model | Required | Status | Checks |
| --- | --- | --- | --- | --- |
| S1 | fast | yes | pass | 3/3 |
| S1 | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S1 | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S2 | fast | yes | pass | 6/6 |
| S2 | anthropic/claude-haiku-4-5 | yes | pass | 6/6 |
| S2 | openai/gpt-5.6-luna#low | yes | pass | 6/6 |
| S3 | fast | yes | pass | 3/3 |
| S4 | fast | yes | pass | 4/4 |

## Failures, gaps and unchecked items

### S3 on fast: pass

not checked, usage chunk present when requested: LlamaIndex stream_chat does not request a usage chunk

