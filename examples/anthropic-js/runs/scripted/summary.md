# anthropic-js · scripted

Verdict: **partial** · @anthropic-ai/sdk 0.135.0 on bun 1 · models: fast, anthropic/claude-haiku-4-5, openai/gpt-5.6-luna#low, nope

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
| S6 | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S6 | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S7 | - | yes | gap |  |
| E1 | fast | no | pass | 1/1 |
| E2 | nope | no | pass | 1/1 |

## Failures, gaps and unchecked items

### S7 on -: gap

GET /v1/models ignores x-api-key, which the SDK sends (#399)

```text
Error: 401 {"error":{"message":"Missing or invalid API key","type":"authentication_error","param":null,"code":"invalid_api_key"}}
```

### E1 on fast: pass

not checked, code is invalid_api_key: Messages errors carry error.type and no error.code (src/anthropic/response.ts:112)

### E2 on nope: pass

not checked, code is model_not_found: Messages errors carry error.type and no error.code (src/anthropic/response.ts:112)

