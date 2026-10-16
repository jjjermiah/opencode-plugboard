# langchain-google-genai · live

Verdict: **partial** · langchain-google-genai 4.4.2 on python 3 · models: fast, anthropic/claude-haiku-4-5, openai/gpt-5.6-luna#low, nope
Date: 2026-10-16 · plugboard 0.37.0 (987338b) · OpenCode 2.0.29

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
| S5 | fast | yes | gap |  |
| S5 | anthropic/claude-haiku-4-5 | yes | gap |  |
| S5 | openai/gpt-5.6-luna#low | yes | gap |  |
| S6 | fast | yes | pass | 3/3 |
| S6 | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S6 | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S7 | - | yes | n/a |  |
| E1 | fast | no | pass | 1/1 |
| E2 | nope | no | pass | 1/1 |

## Failures, gaps and unchecked items

### S5 on fast: gap

LangChain sends inlineData as mime_type, which plugboard rejects with 400 INVALID_ARGUMENT (#401)

```text
GoogleInvalidRequestError: Error calling model 'fast' (INVALID_ARGUMENT): 400 INVALID_ARGUMENT. {'error': {'code': 400, 'message': 'inlineData needs mimeType and base64 data', 'status': 'INVALID_ARGUMENT', 'details': [{'@type': 'type.googleapis.com/google.rpc.BadRequest', 'fieldViolations': [{'field': 'contents[0].parts[1].inlineData', 'description': 'inlineData needs mimeType and base64 data'}]}]}}
```

### S5 on anthropic/claude-haiku-4-5: gap

LangChain sends inlineData as mime_type, which plugboard rejects with 400 INVALID_ARGUMENT (#401)

```text
GoogleInvalidRequestError: Error calling model 'anthropic/claude-haiku-4-5' (INVALID_ARGUMENT): 400 INVALID_ARGUMENT. {'error': {'code': 400, 'message': 'inlineData needs mimeType and base64 data', 'status': 'INVALID_ARGUMENT', 'details': [{'@type': 'type.googleapis.com/google.rpc.BadRequest', 'fieldViolations': [{'field': 'contents[0].parts[1].inlineData', 'description': 'inlineData needs mimeType and base64 data'}]}]}}
```

### S5 on openai/gpt-5.6-luna#low: gap

LangChain sends inlineData as mime_type, which plugboard rejects with 400 INVALID_ARGUMENT (#401)

```text
GoogleInvalidRequestError: Error calling model 'openai/gpt-5.6-luna%23low' (INVALID_ARGUMENT): 400 INVALID_ARGUMENT. {'error': {'code': 400, 'message': 'inlineData needs mimeType and base64 data', 'status': 'INVALID_ARGUMENT', 'details': [{'@type': 'type.googleapis.com/google.rpc.BadRequest', 'fieldViolations': [{'field': 'contents[0].parts[1].inlineData', 'description': 'inlineData needs mimeType and base64 data'}]}]}}
```

### E1 on fast: pass

not checked, code is invalid_api_key: Google's error body names the status UNAUTHENTICATED, not invalid_api_key; the status 401 is checked

### E2 on nope: pass

not checked, code is model_not_found: Google's error body names the status NOT_FOUND, not model_not_found; the status 404 is checked

