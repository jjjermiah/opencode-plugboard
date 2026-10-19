# promptfoo

An eval and red-team tool. Its `openai:chat:<model>` provider calls plugboard's Chat Completions.

## Connect

`promptfooconfig.yaml`:

```yaml
prompts:
  - "{{input}}"

providers:
  - id: openai:chat:fast
    config:
      apiBaseUrl: "{{ env.PLUGBOARD_URL }}"
      apiKey: "{{ env.PLUGBOARD_KEY }}"
      max_tokens: 1024
      tools:
        - type: function
          function:
            name: get_weather
            description: Current weather for a city.
            parameters:
              type: object
              properties:
                city:
                  type: string
              required: [city]

tests:
  - vars:
      input: "Reply with exactly: pong"
    assert:
      - type: icontains
        value: pong
  - vars:
      input: "What is the weather in Paris? Use the tool."
    assert:
      - type: is-valid-openai-tools-call
```

```sh
PLUGBOARD_URL=http://127.0.0.1:4010/v1 PLUGBOARD_KEY=<your key> npx promptfoo@latest eval --no-cache
```

`apiBaseUrl` keeps `/v1`. The model name goes after `openai:chat:`. A copy is in [examples/promptfoo/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/promptfoo).

## What works

Text and tool-call assertions, and several choices per prompt with `config.passthrough: { n: 3 }` when the server's `maxN` allows it.

## Limits

- Model-graded assertions (`llm-rubric` and others) call OpenAI by default. Point the grader at plugboard with `defaultTest.options.provider`, using the same `apiBaseUrl` and key.
- Put per-test prompts in a variable, as above: a per-test `prompt:` key is ignored.
- Give a reasoning model a `max_tokens` budget (1024 or more) so it has room to answer.
