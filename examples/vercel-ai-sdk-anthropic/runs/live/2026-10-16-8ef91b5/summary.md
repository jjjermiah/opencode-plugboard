# vercel-ai-sdk-anthropic · live

Verdict: **partial** · @ai-sdk/anthropic 4.0.81 on bun 1 · models: fast, anthropic/claude-haiku-4-5, openai/gpt-5.6-luna#low, nope
Date: 2026-10-16 · plugboard 0.37.0 (8ef91b5) · OpenCode 2.0.29

| Scenario | Model | Required | Status | Checks |
| --- | --- | --- | --- | --- |
| S1 | fast | yes | pass | 3/3 |
| S1 | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S1 | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S2 | fast | yes | pass | 6/6 |
| S2 | anthropic/claude-haiku-4-5 | yes | pass | 6/6 |
| S2 | openai/gpt-5.6-luna#low | yes | pass | 6/6 |
| S3 | fast | yes | pass | 4/4 |
| S4 | fast | yes | pass | 4/4 |
| S5 | fast | yes | pass | 1/1 |
| S5 | anthropic/claude-haiku-4-5 | yes | pass | 1/1 |
| S5 | openai/gpt-5.6-luna#low | yes | pass | 1/1 |
| S6 | fast | yes | pass | 3/3 |
| S6 | anthropic/claude-haiku-4-5 | yes | gap |  |
| S6 | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S7 | - | yes | pass | 3/3 |
| E1 | fast | no | gap | 1/2 |
| E2 | nope | no | gap | 1/2 |

## Failures, gaps and unchecked items

### S6 on anthropic/claude-haiku-4-5: gap

plugboard refuses output_config.format on /v1/messages (docs/messages.md) (#102)

```text
AI_APICallError: output_config.format: structured outputs are not supported
```

### E1 on fast: gap

Messages errors use Anthropic's error.type, not an error.code (#102)

Failed checks: code is invalid_api_key

### E2 on nope: gap

Messages errors use Anthropic's error.type, not an error.code (#102)

Failed checks: code is model_not_found

