# promptfoo

An eval and red-team tool. Its `openai:chat:<model>` provider calls plugboard's Chat Completions.

## Connect

`promptfooconfig.yaml`:

<<< @/../examples/promptfoo/promptfooconfig.yaml#snippet

```sh
PLUGBOARD_URL=http://127.0.0.1:4010/v1 PLUGBOARD_KEY=<your key> npx promptfoo@latest eval --no-cache
```

`apiBaseUrl` keeps `/v1`. The model name goes after `openai:chat:`. The file is in [examples/promptfoo/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/promptfoo).

## What works

Text and tool-call assertions, and several choices per prompt with `config.passthrough: { n: 3 }` when the server's `maxN` allows it.

## Limits

- Model-graded assertions (`llm-rubric` and others) call OpenAI by default. Point the grader at plugboard with `defaultTest.options.provider`, using the same `apiBaseUrl` and key.
- Put per-test prompts in a variable, as in the config: a per-test `prompt:` key is ignored.
- Give a reasoning model a `max_tokens` budget (1024 or more) so it has room to answer.
