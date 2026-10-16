# semantic-kernel · scripted

Verdict: **partial** · semantic-kernel 1.45.0 on python 3 · models: fast, anthropic/claude-haiku-4-5, openai/gpt-5.6-luna#low

| Scenario | Model | Required | Status | Checks |
| --- | --- | --- | --- | --- |
| S1 | fast | yes | pass | 3/3 |
| S1 | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S1 | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S2 | fast | yes | gap |  |
| S2 | anthropic/claude-haiku-4-5 | yes | gap |  |
| S2 | openai/gpt-5.6-luna#low | yes | gap |  |
| S3 | fast | yes | pass | 4/4 |
| S4 | fast | yes | gap |  |

## Failures, gaps and unchecked items

### S2 on fast: gap

Semantic Kernel sends the tool as weather-get_weather (plugin prefix); the scripted model answers only get_weather (#105)

```text
ServiceResponseException: ("<class 'semantic_kernel.connectors.ai.open_ai.services.open_ai_chat_completion.OpenAIChatCompletion'> service failed to complete the prompt", InternalServerError("Error code: 500 - {'error': {'message': 'scripted model has no answer for this prompt: What is the weather in Paris? Use the tool.', 'type': 'server_error', 'param': None, 'code': None}}"))
```

### S2 on anthropic/claude-haiku-4-5: gap

Semantic Kernel sends the tool as weather-get_weather (plugin prefix); the scripted model answers only get_weather (#105)

```text
ServiceResponseException: ("<class 'semantic_kernel.connectors.ai.open_ai.services.open_ai_chat_completion.OpenAIChatCompletion'> service failed to complete the prompt", InternalServerError("Error code: 500 - {'error': {'message': 'scripted model has no answer for this prompt: What is the weather in Paris? Use the tool.', 'type': 'server_error', 'param': None, 'code': None}}"))
```

### S2 on openai/gpt-5.6-luna#low: gap

Semantic Kernel sends the tool as weather-get_weather (plugin prefix); the scripted model answers only get_weather (#105)

```text
ServiceResponseException: ("<class 'semantic_kernel.connectors.ai.open_ai.services.open_ai_chat_completion.OpenAIChatCompletion'> service failed to complete the prompt", InternalServerError("Error code: 500 - {'error': {'message': 'scripted model has no answer for this prompt: What is the weather in Paris? Use the tool.', 'type': 'server_error', 'param': None, 'code': None}}"))
```

### S4 on fast: gap

Semantic Kernel sends the tool as weather-get_weather (plugin prefix); the scripted model answers only get_weather (#105)

```text
ServiceResponseException: ("<class 'semantic_kernel.connectors.ai.open_ai.services.open_ai_chat_completion.OpenAIChatCompletion'> service failed to complete the prompt", InternalServerError("Error code: 500 - {'error': {'message': 'scripted model has no answer for this prompt: What is the weather in Paris? Use the tool.', 'type': 'server_error', 'param': None, 'code': None}}"))
```

