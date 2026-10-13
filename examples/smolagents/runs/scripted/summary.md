# smolagents · scripted

Verdict: **partial** · smolagents 1.26.0 on python 3 · models: fast, anthropic/claude-haiku-4-5, openai/gpt-5.6-luna#low

| Scenario | Model | Required | Status | Checks |
| --- | --- | --- | --- | --- |
| S1 | fast | yes | pass | 3/3 |
| S1 | anthropic/claude-haiku-4-5 | yes | pass | 3/3 |
| S1 | openai/gpt-5.6-luna#low | yes | pass | 3/3 |
| S2 | fast | yes | gap | 5/6 |
| S2 | anthropic/claude-haiku-4-5 | yes | gap | 5/6 |
| S2 | openai/gpt-5.6-luna#low | yes | gap | 5/6 |
| S3 | fast | yes | gap | 3/4 |

## Failures, gaps and unchecked items

### S2 on fast: gap

smolagents ends a run with a final_answer tool call, so its last model turn finishes with tool_calls, and the check expects stop; the tool call and the final answer are observed and pass (#362)

Failed checks: turn 2 finish_reason is stop

### S2 on anthropic/claude-haiku-4-5: gap

smolagents ends a run with a final_answer tool call, so its last model turn finishes with tool_calls, and the check expects stop; the tool call and the final answer are observed and pass (#362)

Failed checks: turn 2 finish_reason is stop

### S2 on openai/gpt-5.6-luna#low: gap

smolagents ends a run with a final_answer tool call, so its last model turn finishes with tool_calls, and the check expects stop; the tool call and the final answer are observed and pass (#362)

Failed checks: turn 2 finish_reason is stop

### S3 on fast: gap

smolagents' generate_stream does not return finish_reason, so the finish_reason check cannot be observed; the streamed text and usage are (#362)

Failed checks: finish_reason is stop

