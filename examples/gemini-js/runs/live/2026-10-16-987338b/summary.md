# gemini-js · live

Verdict: **pass** · @google/genai 2.30.0 on bun 1 · models: fast, anthropic/claude-haiku-4-5, openai/gpt-5.6-luna#low, nope
Date: 2026-10-16 · plugboard 0.37.0 (987338b) · OpenCode 2.0.29

| Scenario | Model | Required | Status | Checks |
| --- | --- | --- | --- | --- |
| S1 | fast | yes | pass | 3/3 |
| S1 | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S1 | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S2 | fast | yes | pass | 5/5 |
| S2 | anthropic/claude-haiku-4-5 | yes | pass | 5/5 |
| S2 | openai/gpt-5.6-luna#low | yes | pass | 5/5 |
| S3 | fast | yes | pass | 4/4 |
| S4 | fast | yes | pass | 3/3 |
| S5 | fast | yes | pass | 1/1 |
| S5 | anthropic/claude-haiku-4-5 | yes | pass | 1/1 |
| S5 | openai/gpt-5.6-luna#low | yes | pass | 1/1 |
| S6 | fast | yes | pass | 3/3 |
| S6 | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S6 | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S7 | - | yes | pass | 3/3 |
| E1 | fast | no | pass | 1/1 |
| E2 | nope | no | pass | 1/1 |

## Failures, gaps and unchecked items

### S2 on fast: pass

not checked, call id present: Gemini function calls carry no id (Google's API); the call is paired with its result by name, so there is nothing to check

### S2 on anthropic/claude-haiku-4-5: pass

not checked, call id present: Gemini function calls carry no id (Google's API); the call is paired with its result by name, so there is nothing to check

### S2 on openai/gpt-5.6-luna#low: pass

not checked, call id present: Gemini function calls carry no id (Google's API); the call is paired with its result by name, so there is nothing to check

### S4 on fast: pass

not checked, call id present: Gemini function calls carry no id (Google's API); the call is paired with its result by name, so there is nothing to check

### E1 on fast: pass

not checked, code is invalid_api_key: Google's error body names the status UNAUTHENTICATED, not invalid_api_key; the status 401 is checked

### E2 on nope: pass

not checked, code is model_not_found: Google's error body names the status NOT_FOUND, not model_not_found; the status 404 is checked

