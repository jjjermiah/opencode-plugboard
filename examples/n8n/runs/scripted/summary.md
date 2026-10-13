# n8n · scripted

Verdict: **partial** · n8n 2.42.6 on bun 1 · models: fast, anthropic/claude-haiku-4-5, openai/gpt-5.6-luna#low, nope

| Scenario | Model | Required | Status | Checks |
| --- | --- | --- | --- | --- |
| S1 (chat) | fast | yes | pass | 3/3 |
| S1 (responses) | fast | yes | gap | 1/3 |
| S1 (chat) | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S1 (responses) | anthropic/claude-haiku-4-5 | yes | gap | 1/3 |
| S1 (chat) | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S1 (responses) | openai/gpt-5.6-luna#low | yes | gap | 1/3 |
| S2 | fast | yes | pass | 6/6 |
| S2 | anthropic/claude-haiku-4-5 | yes | pass | 6/6 |
| S2 | openai/gpt-5.6-luna#low | yes | pass | 6/6 |
| S3 | fast | yes | pass | 4/4 |
| S4 | fast | yes | pass | 4/4 |
| S5 | fast | yes | pass | 1/1 |
| S5 | anthropic/claude-haiku-4-5 | yes | pass | 1/1 |
| S5 | openai/gpt-5.6-luna#low | yes | pass | 1/1 |
| S6 | fast | yes | gap | 1/3 |
| S6 | anthropic/claude-haiku-4-5 | yes | gap | 1/3 |
| S6 | openai/gpt-5.6-luna#low | yes | gap | 1/3 |
| S7 | - | yes | pass | 3/3 |
| E1 | fast | no | n/a |  |
| E2 | nope | no | n/a |  |

## Failures and gaps

### S1 (responses) on fast: gap

n8n's Responses node records no finish_reason and only an estimated usage, so those checks cannot be read (https://github.com/jjjermiah/opencode-plugboard/issues/343)

Failed checks: finish_reason is stop; usage present

### S1 (responses) on anthropic/claude-haiku-4-5: gap

n8n's Responses node records no finish_reason and only an estimated usage, so those checks cannot be read (https://github.com/jjjermiah/opencode-plugboard/issues/343)

Failed checks: finish_reason is stop; usage present

### S1 (responses) on openai/gpt-5.6-luna#low: gap

n8n's Responses node records no finish_reason and only an estimated usage, so those checks cannot be read (https://github.com/jjjermiah/opencode-plugboard/issues/343)

Failed checks: finish_reason is stop; usage present

### S6 on fast: gap

the scripted S6 answer has no output wrapper for n8n's Structured Output Parser (live passes) (https://github.com/jjjermiah/opencode-plugboard/issues/344)

Failed checks: calories is a number; protein_g is a number

### S6 on anthropic/claude-haiku-4-5: gap

the scripted S6 answer has no output wrapper for n8n's Structured Output Parser (live passes) (https://github.com/jjjermiah/opencode-plugboard/issues/344)

Failed checks: calories is a number; protein_g is a number

### S6 on openai/gpt-5.6-luna#low: gap

the scripted S6 answer has no output wrapper for n8n's Structured Output Parser (live passes) (https://github.com/jjjermiah/opencode-plugboard/issues/344)

Failed checks: calories is a number; protein_g is a number

