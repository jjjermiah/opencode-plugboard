# openai-agents-js · live

Verdict: **fail** · openai-agents-js 0.20.0 on bun 1 · models: fast, anthropic/claude-haiku-4-5, openai/gpt-5.6-luna#low, nope
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
| S7 | - | yes | n/a |  |
| E1 | fast | no | pass | 2/2 |
| E2 | nope | no | pass | 2/2 |

## Failures, gaps and unchecked items

### S1 on fast: fail

```text
Error: 429 The model provider is rate limiting requests; retry later
```

### S2 on fast: fail

```text
Error: 429 The model provider is rate limiting requests; retry later
```

### S3 on fast: fail

Failed checks: stream ended normally

```text
Error: 429 The model provider is rate limiting requests; retry later
```

### S4 on fast: fail

```text
Error: 429 The model provider is rate limiting requests; retry later
```

### S5 on fast: fail

```text
Error: 429 The model provider is rate limiting requests; retry later
```

### S6 on fast: fail

```text
Error: 429 The model provider is rate limiting requests; retry later
```

