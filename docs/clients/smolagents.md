# smolagents

Hugging Face's smolagents, through `OpenAIModel`.

## Connect

```sh
pip install 'smolagents[openai]'
```

`BASE` is `http://127.0.0.1:4010/v1` and `KEY` is your plugboard key.

<<< @/../examples/smolagents/run.py#snippet

Keep `/v1` in `api_base`. `smolagents` alone, without the `openai` extra, raises `ModuleNotFoundError` for `OpenAIModel`.

To stream, iterate `model.generate_stream`:

<<< @/../examples/smolagents/run.py#snippet-stream

A tool is a `@tool` function with a docstring, run by a `ToolCallingAgent`:

<<< @/../examples/smolagents/run.py#snippet-tool

<<< @/../examples/smolagents/run.py#snippet-agent

A script with a text reply, a stream and a tool-calling agent is in [examples/smolagents/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/smolagents):

```sh
cd examples/smolagents
PLUGBOARD_KEY=<app key> uv run example.py
```

## What works

`model.generate`, `model.generate_stream`, and `ToolCallingAgent` with `@tool` functions.

## Limits

- Keep smolagents' default role conversion. Forcing tool results into the `tool` role fails with 400 `Tool messages need a tool_call_id`, because smolagents sends no call id.
- An agent run ends with a `final_answer` tool call, so its last turn finishes with `tool_calls`, not `stop`.
