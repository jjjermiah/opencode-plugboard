# openai-python · live

Verdict: **fail** · openai 3.29.0 on python 3 · models: fast, anthropic/claude-haiku-4-5, openai/gpt-5.6-luna#low, nope
Date: 2026-10-16 · plugboard 0.37.0 (b41c376) · OpenCode 2.0.29

| Scenario | Model | Required | Status | Checks |
| --- | --- | --- | --- | --- |
| S1 (chat) | fast | yes | fail |  |
| S1 (responses) | fast | yes | fail |  |
| S1 (chat) | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S1 (responses) | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S1 (chat) | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S1 (responses) | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S2 (chat) | fast | yes | fail |  |
| S2 (responses) | fast | yes | fail |  |
| S2 (responses-previous-id) | fast | yes | gap |  |
| S2 (chat) | anthropic/claude-haiku-4-5 | yes | pass | 6/6 |
| S2 (responses) | anthropic/claude-haiku-4-5 | yes | pass | 6/6 |
| S2 (responses-previous-id) | anthropic/claude-haiku-4-5 | yes | gap |  |
| S2 (chat) | openai/gpt-5.6-luna#low | yes | pass | 6/6 |
| S2 (responses) | openai/gpt-5.6-luna#low | yes | pass | 6/6 |
| S2 (responses-previous-id) | openai/gpt-5.6-luna#low | yes | gap |  |
| S3 (chat) | fast | yes | fail | 0/1 |
| S3 (responses) | fast | yes | fail | 0/1 |
| S4 | fast | yes | fail |  |
| S5 (chat) | fast | yes | fail |  |
| S5 (responses) | fast | yes | fail |  |
| S5 (chat) | anthropic/claude-haiku-4-5 | yes | pass | 1/1 |
| S5 (responses) | anthropic/claude-haiku-4-5 | yes | pass | 1/1 |
| S5 (chat) | openai/gpt-5.6-luna#low | yes | pass | 1/1 |
| S5 (responses) | openai/gpt-5.6-luna#low | yes | pass | 1/1 |
| S6 (chat) | fast | yes | fail |  |
| S6 (responses) | fast | yes | fail |  |
| S6 (chat) | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S6 (responses) | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S6 (chat) | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S6 (responses) | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S7 | - | yes | pass | 3/3 |
| E1 | fast | no | pass | 2/2 |
| E2 | nope | no | pass | 2/2 |

## Failures, gaps and unchecked items

### S1 (chat) on fast: fail

```text
RateLimitError: Error code: 429 - {'error': {'message': 'The model provider is rate limiting requests; retry later', 'type': 'rate_limit_error', 'param': None, 'code': 'rate_limited'}}
```

### S1 (responses) on fast: fail

```text
RateLimitError: Error code: 429 - {'error': {'message': 'The model provider is rate limiting requests; retry later', 'type': 'rate_limit_error', 'param': None, 'code': 'rate_limited'}}
```

### S2 (chat) on fast: fail

```text
RateLimitError: Error code: 429 - {'error': {'message': 'The model provider is rate limiting requests; retry later', 'type': 'rate_limit_error', 'param': None, 'code': 'rate_limited'}}
```

### S2 (responses) on fast: fail

```text
RateLimitError: Error code: 429 - {'error': {'message': 'The model provider is rate limiting requests; retry later', 'type': 'rate_limit_error', 'param': None, 'code': 'rate_limited'}}
```

### S2 (responses-previous-id) on fast: gap

previous_response_id is refused: plugboard is stateless, send the full input (docs/responses.md) (#104)

```text
RateLimitError: Error code: 429 - {'error': {'message': 'The model provider is rate limiting requests; retry later', 'type': 'rate_limit_error', 'param': None, 'code': 'rate_limited'}}
```

### S2 (responses-previous-id) on anthropic/claude-haiku-4-5: gap

previous_response_id is refused: plugboard is stateless, send the full input (docs/responses.md) (#104)

```text
BadRequestError: Error code: 400 - {'error': {'message': 'previous_response_id is not supported: plugboard is stateless, send the full conversation in input', 'type': 'invalid_request_error', 'param': 'previous_response_id', 'code': 'unsupported_parameter'}}
```

### S2 (responses-previous-id) on openai/gpt-5.6-luna#low: gap

previous_response_id is refused: plugboard is stateless, send the full input (docs/responses.md) (#104)

```text
BadRequestError: Error code: 400 - {'error': {'message': 'previous_response_id is not supported: plugboard is stateless, send the full conversation in input', 'type': 'invalid_request_error', 'param': 'previous_response_id', 'code': 'unsupported_parameter'}}
```

### S3 (chat) on fast: fail

Failed checks: stream ended normally

```text
RateLimitError: Error code: 429 - {'error': {'message': 'The model provider is rate limiting requests; retry later', 'type': 'rate_limit_error', 'param': None, 'code': 'rate_limited'}}
```

### S3 (responses) on fast: fail

Failed checks: stream ended normally

```text
RateLimitError: Error code: 429 - {'error': {'message': 'The model provider is rate limiting requests; retry later', 'type': 'rate_limit_error', 'param': None, 'code': 'rate_limited'}}
```

### S4 on fast: fail

```text
RateLimitError: Error code: 429 - {'error': {'message': 'The model provider is rate limiting requests; retry later', 'type': 'rate_limit_error', 'param': None, 'code': 'rate_limited'}}
```

### S5 (chat) on fast: fail

```text
RateLimitError: Error code: 429 - {'error': {'message': 'The model provider is rate limiting requests; retry later', 'type': 'rate_limit_error', 'param': None, 'code': 'rate_limited'}}
```

### S5 (responses) on fast: fail

```text
RateLimitError: Error code: 429 - {'error': {'message': 'The model provider is rate limiting requests; retry later', 'type': 'rate_limit_error', 'param': None, 'code': 'rate_limited'}}
```

### S6 (chat) on fast: fail

```text
RateLimitError: Error code: 429 - {'error': {'message': 'The model provider is rate limiting requests; retry later', 'type': 'rate_limit_error', 'param': None, 'code': 'rate_limited'}}
```

### S6 (responses) on fast: fail

```text
RateLimitError: Error code: 429 - {'error': {'message': 'The model provider is rate limiting requests; retry later', 'type': 'rate_limit_error', 'param': None, 'code': 'rate_limited'}}
```

