# anthropic-js · live

Verdict: **fail** · @anthropic-ai/sdk 0.135.0 on bun 1 · models: fast, anthropic/claude-haiku-4-5, openai/gpt-5.6-luna#low, nope
Date: 2026-10-16 · plugboard 0.37.0 (b41c376) · OpenCode 2.0.29

| Scenario | Model | Required | Status | Checks |
| --- | --- | --- | --- | --- |
| S1 | fast | yes | fail |  |
| S1 | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S1 | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S2 | fast | yes | fail |  |
| S2 | anthropic/claude-haiku-4-5 | yes | pass | 6/6 |
| S2 | openai/gpt-5.6-luna#low | yes | pass | 6/6 |
| S3 | fast | yes | fail | 0/1 |
| S4 | fast | yes | fail |  |
| S5 | fast | yes | fail |  |
| S5 | anthropic/claude-haiku-4-5 | yes | pass | 1/1 |
| S5 | openai/gpt-5.6-luna#low | yes | pass | 1/1 |
| S6 | fast | yes | fail |  |
| S6 | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S6 | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S7 | - | yes | gap |  |
| E1 | fast | no | pass | 1/1 |
| E2 | nope | no | pass | 1/1 |

## Failures, gaps and unchecked items

### S1 on fast: fail

```text
Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"The model provider is rate limiting requests; retry later"}}
```

### S2 on fast: fail

```text
Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"The model provider is rate limiting requests; retry later"}}
```

### S3 on fast: fail

Failed checks: stream ended normally

```text
Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"The model provider is rate limiting requests; retry later"}}
```

### S4 on fast: fail

```text
Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"The model provider is rate limiting requests; retry later"}}
```

### S5 on fast: fail

```text
Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"The model provider is rate limiting requests; retry later"}}
```

### S6 on fast: fail

```text
Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"The model provider is rate limiting requests; retry later"}}
```

### S7 on -: gap

GET /v1/models ignores x-api-key, which the SDK sends (#399)

```text
Error: 401 {"error":{"message":"Missing or invalid API key","type":"authentication_error","param":null,"code":"invalid_api_key"}}
```

### E1 on fast: pass

not checked, code is invalid_api_key: Messages errors carry error.type and no error.code (src/anthropic/response.ts:112)

### E2 on nope: pass

not checked, code is model_not_found: Messages errors carry error.type and no error.code (src/anthropic/response.ts:112)

