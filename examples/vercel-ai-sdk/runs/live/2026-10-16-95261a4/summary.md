# vercel-ai-sdk · live

Verdict: **fail** · vercel-ai-sdk 7.0.137 on bun 1 · models: fast, anthropic/claude-haiku-4-5, openai/gpt-5.6-luna#low, nope
Date: 2026-10-16 · plugboard 0.41.0 (95261a4) · OpenCode 2.0.29

| Scenario | Model | Required | Status | Checks |
| --- | --- | --- | --- | --- |
| S1 (compat) | fast | yes | fail |  |
| S1 (openai-chat) | fast | yes | fail |  |
| S1 (responses) | fast | yes | fail |  |
| S1 (compat) | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S1 (openai-chat) | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S1 (responses) | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S1 (compat) | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S1 (openai-chat) | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S1 (responses) | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S2 (compat) | fast | yes | fail |  |
| S2 (openai-chat) | fast | yes | fail |  |
| S2 (responses) | fast | yes | fail |  |
| S2 (responses-store-false) | fast | yes | fail |  |
| S2 (compat) | anthropic/claude-haiku-4-5 | yes | pass | 6/6 |
| S2 (openai-chat) | anthropic/claude-haiku-4-5 | yes | pass | 6/6 |
| S2 (responses) | anthropic/claude-haiku-4-5 | yes | pass | 6/6 |
| S2 (responses-store-false) | anthropic/claude-haiku-4-5 | yes | pass | 6/6 |
| S2 (compat) | openai/gpt-5.6-luna#low | yes | pass | 6/6 |
| S2 (openai-chat) | openai/gpt-5.6-luna#low | yes | pass | 6/6 |
| S2 (responses) | openai/gpt-5.6-luna#low | yes | pass | 6/6 |
| S2 (responses-store-false) | openai/gpt-5.6-luna#low | yes | pass | 6/6 |
| S3 (compat) | fast | yes | fail | 0/1 |
| S3 (openai-chat) | fast | yes | fail | 0/1 |
| S3 (responses) | fast | yes | fail | 0/1 |
| S4 (compat) | fast | yes | fail | 0/4 |
| S4 (openai-chat) | fast | yes | fail | 0/4 |
| S4 (responses) | fast | yes | fail | 0/4 |
| S5 (compat) | fast | yes | fail |  |
| S5 (openai-chat) | fast | yes | fail |  |
| S5 (responses) | fast | yes | fail |  |
| S5 (compat) | anthropic/claude-haiku-4-5 | yes | pass | 1/1 |
| S5 (openai-chat) | anthropic/claude-haiku-4-5 | yes | pass | 1/1 |
| S5 (responses) | anthropic/claude-haiku-4-5 | yes | pass | 1/1 |
| S5 (compat) | openai/gpt-5.6-luna#low | yes | pass | 1/1 |
| S5 (openai-chat) | openai/gpt-5.6-luna#low | yes | pass | 1/1 |
| S5 (responses) | openai/gpt-5.6-luna#low | yes | pass | 1/1 |
| S6 (compat) | fast | yes | fail |  |
| S6 (openai-chat) | fast | yes | fail |  |
| S6 (responses) | fast | yes | fail |  |
| S6 (compat) | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S6 (openai-chat) | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S6 (responses) | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S6 (compat) | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S6 (openai-chat) | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S6 (responses) | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S7 | - | yes | pass | 3/3 |
| E1 | fast | no | pass | 2/2 |
| E2 | nope | no | pass | 2/2 |

## Failures, gaps and unchecked items

### S1 (compat) on fast: fail

```text
AI_RetryError: Failed after 3 attempts. Last error: AI_APICallError: The model provider is rate limiting requests; retry later
```

### S1 (openai-chat) on fast: fail

```text
AI_RetryError: Failed after 3 attempts. Last error: AI_APICallError: The model provider is rate limiting requests; retry later
```

### S1 (responses) on fast: fail

```text
AI_RetryError: Failed after 3 attempts. Last error: AI_APICallError: The model provider is rate limiting requests; retry later
```

### S2 (compat) on fast: fail

```text
AI_RetryError: Failed after 3 attempts. Last error: AI_APICallError: The model provider is rate limiting requests; retry later
```

### S2 (openai-chat) on fast: fail

```text
AI_RetryError: Failed after 3 attempts. Last error: AI_APICallError: The model provider is rate limiting requests; retry later
```

### S2 (responses) on fast: fail

```text
AI_RetryError: Failed after 3 attempts. Last error: AI_APICallError: The model provider is rate limiting requests; retry later
```

### S2 (responses-store-false) on fast: fail

```text
AI_RetryError: Failed after 3 attempts. Last error: AI_APICallError: The model provider is rate limiting requests; retry later
```

### S3 (compat) on fast: fail

Failed checks: stream ended normally

```text
Error: stream without usage gave ""
```

### S3 (openai-chat) on fast: fail

Failed checks: stream ended normally

```text
Error: stream without usage gave ""
```

### S3 (responses) on fast: fail

Failed checks: stream ended normally

```text
Error: stream without usage gave ""
```

### S4 (compat) on fast: fail

Failed checks: finish_reason is tool_calls; streamed get_weather call; city is Paris; call id present

### S4 (openai-chat) on fast: fail

Failed checks: finish_reason is tool_calls; streamed get_weather call; city is Paris; call id present

### S4 (responses) on fast: fail

Failed checks: finish_reason is tool_calls; streamed get_weather call; city is Paris; call id present

### S5 (compat) on fast: fail

```text
AI_RetryError: Failed after 3 attempts. Last error: AI_APICallError: The model provider is rate limiting requests; retry later
```

### S5 (openai-chat) on fast: fail

```text
AI_RetryError: Failed after 3 attempts. Last error: AI_APICallError: The model provider is rate limiting requests; retry later
```

### S5 (responses) on fast: fail

```text
AI_RetryError: Failed after 3 attempts. Last error: AI_APICallError: The model provider is rate limiting requests; retry later
```

### S6 (compat) on fast: fail

```text
AI_RetryError: Failed after 3 attempts. Last error: AI_APICallError: The model provider is rate limiting requests; retry later
```

### S6 (openai-chat) on fast: fail

```text
AI_RetryError: Failed after 3 attempts. Last error: AI_APICallError: The model provider is rate limiting requests; retry later
```

### S6 (responses) on fast: fail

```text
AI_RetryError: Failed after 3 attempts. Last error: AI_APICallError: The model provider is rate limiting requests; retry later
```

