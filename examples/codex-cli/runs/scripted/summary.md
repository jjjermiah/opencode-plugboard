# codex-cli · scripted

Verdict: **partial** · @openai/codex 0.163.0 on bun 1 · models: fast, anthropic/claude-haiku-4-5, openai/gpt-5.6-luna#low, nope

| Scenario | Model | Required | Status | Checks |
| --- | --- | --- | --- | --- |
| S1 | fast | yes | pass | 2/2 |
| S1 | anthropic/claude-haiku-4-5 | yes | pass | 2/2 |
| S1 | openai/gpt-5.6-luna#low | yes | gap |  |
| S2 | fast | yes | gap |  |
| S2 | anthropic/claude-haiku-4-5 | yes | gap |  |
| S2 | openai/gpt-5.6-luna#low | yes | gap |  |
| S3 | fast | yes | pass | 3/3 |
| S4 | fast | yes | gap |  |
| S5 | fast | yes | n/a |  |
| S5 | anthropic/claude-haiku-4-5 | yes | n/a |  |
| S5 | openai/gpt-5.6-luna#low | yes | n/a |  |
| S6 | fast | yes | n/a |  |
| S6 | anthropic/claude-haiku-4-5 | yes | n/a |  |
| S6 | openai/gpt-5.6-luna#low | yes | n/a |  |
| S7 | - | yes | n/a |  |
| E1 | fast | no | n/a |  |
| E2 | nope | no | n/a |  |

## Failures, gaps and unchecked items

### S1 on fast: pass

not checked, finish_reason is stop: the CLI's events carry no finish reason; the turn is recorded as completed or failed

### S1 on anthropic/claude-haiku-4-5: pass

not checked, finish_reason is stop: the CLI's events carry no finish reason; the turn is recorded as completed or failed

### S1 on openai/gpt-5.6-luna#low: gap

for a model slug it knows, Codex sends its tools as an `additional_tools` input item, which plugboard refuses with a 400. An alias such as fast avoids it (#498)

```text
Error: codex turn failed: {"error":{"message":"Unsupported input item type \"additional_tools\"","type":"invalid_request_error","param":"input[0].type","code":"unsupported_parameter"}}
```

### S2 on fast: gap

Codex sends an MCP server's tools as a `namespace` tool, and plugboard accepts function tools only: the request gets a 400 (#498)

```text
Error: codex turn failed: {"error":{"message":"Unsupported tool type \"namespace\": only function tools are supported (built-in tools such as web_search and file_search run on OpenAI's servers)","type":"invalid_request_error","param":"tools[6].type","code":"unsupported_parameter"}}
```

### S2 on anthropic/claude-haiku-4-5: gap

Codex sends an MCP server's tools as a `namespace` tool, and plugboard accepts function tools only: the request gets a 400 (#498)

```text
Error: codex turn failed: {"error":{"message":"Unsupported tool type \"namespace\": only function tools are supported (built-in tools such as web_search and file_search run on OpenAI's servers)","type":"invalid_request_error","param":"tools[6].type","code":"unsupported_parameter"}}
```

### S2 on openai/gpt-5.6-luna#low: gap

for a model slug it knows, Codex sends its tools as an `additional_tools` input item, which plugboard refuses with a 400. An alias such as fast avoids it (#498)

```text
Error: codex turn failed: {"error":{"message":"Unsupported input item type \"additional_tools\"","type":"invalid_request_error","param":"input[0].type","code":"unsupported_parameter"}}
```

### S3 on fast: pass

not checked, finish_reason is stop: the CLI's events carry no finish reason; the turn is recorded as completed or failed

### S4 on fast: gap

Codex sends an MCP server's tools as a `namespace` tool, and plugboard accepts function tools only: the request gets a 400 (#498)

```text
Error: codex turn failed: {"error":{"message":"Unsupported tool type \"namespace\": only function tools are supported (built-in tools such as web_search and file_search run on OpenAI's servers)","type":"invalid_request_error","param":"tools[6].type","code":"unsupported_parameter"}}
```

