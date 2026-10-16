# openai-js · scripted

Verdict: **partial** · openai 7.32.0 on bun 1 · models: fast, anthropic/claude-haiku-4-5, openai/gpt-5.6-luna#low, nope

| Scenario | Model | Required | Status | Checks |
| --- | --- | --- | --- | --- |
| S1 (chat) | fast | yes | pass | 3/3 |
| S1 (responses) | fast | yes | pass | 3/3 |
| S1 (chat) | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S1 (responses) | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S1 (chat) | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S1 (responses) | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S2 (chat) | fast | yes | pass | 6/6 |
| S2 (responses) | fast | yes | pass | 6/6 |
| S2 (responses-previous-id) | fast | yes | gap |  |
| S2 (chat) | anthropic/claude-haiku-4-5 | yes | pass | 6/6 |
| S2 (responses) | anthropic/claude-haiku-4-5 | yes | pass | 6/6 |
| S2 (responses-previous-id) | anthropic/claude-haiku-4-5 | yes | gap |  |
| S2 (chat) | openai/gpt-5.6-luna#low | yes | pass | 6/6 |
| S2 (responses) | openai/gpt-5.6-luna#low | yes | pass | 6/6 |
| S2 (responses-previous-id) | openai/gpt-5.6-luna#low | yes | gap |  |
| S3 (chat) | fast | yes | pass | 4/4 |
| S3 (responses) | fast | yes | pass | 4/4 |
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

### S2 (responses-previous-id) on fast: gap

previous_response_id is refused: plugboard is stateless, send the full input (docs/responses.md) (#104)

```text
Error: 400 previous_response_id is not supported: plugboard is stateless, send the full conversation in input
```

### S2 (responses-previous-id) on anthropic/claude-haiku-4-5: gap

previous_response_id is refused: plugboard is stateless, send the full input (docs/responses.md) (#104)

```text
Error: 400 previous_response_id is not supported: plugboard is stateless, send the full conversation in input
```

### S2 (responses-previous-id) on openai/gpt-5.6-luna#low: gap

previous_response_id is refused: plugboard is stateless, send the full input (docs/responses.md) (#104)

```text
Error: 400 previous_response_id is not supported: plugboard is stateless, send the full conversation in input
```

