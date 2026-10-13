# promptfoo

Verified: run, 2026-10-13 against the live dev server (`127.0.0.1:4010`, `main`, model `fast`, `max_tokens` 1024). promptfoo CLI 0.124.1 (npm `promptfoo`, `npx promptfoo@0.124.1`), `promptfoo eval --no-cache`. [examples/promptfoo/promptfooconfig.yaml](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/promptfoo) ran green: 2 of 2 passed, one plain-text check (`icontains pong`) and one tool-call check (`is-valid-openai-tools-call` plus a JavaScript assertion). `apiBaseUrl`, `apiKey`, `openai:chat:<model>` and the `tools` option were checked against promptfoo's OpenAI provider docs (promptfoo.dev/docs/providers/openai). The issue's claim that the provider reads `OPENAI_BASE_URL` is not in those docs and was not tested here.

promptfoo is an eval and red-team tool. Its `openai:chat:<model>` provider calls any OpenAI-compatible base URL, so each test reaches plugboard's `POST /v1/chat/completions`.

## Plugboard options

```jsonc
"options": {
  "keys": { "promptfoo": "{env:PLUGBOARD_KEY_PROMPTFOO}" },
  "models": ["anthropic/claude-haiku-4-5"],
  "aliases": { "fast": "anthropic/claude-haiku-4-5" }
}
```

Every alias target must also be in `models`.

## promptfoo config

`promptfooconfig.yaml`:

```yaml
prompts:
  - "{{input}}"

providers:
  - id: openai:chat:fast
    config:
      apiBaseUrl: "{{ env.PLUGBOARD_URL }}"
      apiKey: "{{ env.PLUGBOARD_KEY }}"
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
      - type: javascript
        value: "Array.isArray(output.tool_calls ?? output) && (output.tool_calls ?? output).length > 0"
```

Run it with the URL and key in the environment:

```sh
PLUGBOARD_URL=http://127.0.0.1:4010/v1 PLUGBOARD_KEY=<your app key> npx promptfoo@latest eval --no-cache -o results.json
```

`apiBaseUrl` keeps `/v1`. promptfoo appends `/chat/completions`. The model id goes after `openai:chat:`, exactly as plugboard lists it (`fast`).

## Features exercised

- Chat Completions text, checked with `icontains`.
- Tool calling: the `tools` option sends a function schema, `is-valid-openai-tools-call` checks the call against that schema, and a JavaScript assertion checks that a call was returned.
- Not run: streaming, images, and model-graded assertions.

## Quirks

- **Model-graded assertions use OpenAI by default.** `llm-rubric` and similar call a grader model, which is OpenAI unless you set it. Point it at plugboard with `defaultTest.options.provider` (`id: openai:chat:fast` plus the same `apiBaseUrl` and key). This example uses deterministic assertions only, so it needs no grader. Not run.
- Put the prompt in an `input` variable (the first line of `prompts`) when prompts differ by test. A per-test `prompt:` key was ignored in promptfoo 0.124.1: the second test sent the top-level prompt and failed.
- A `config.apiKey` value written in the YAML is stored in the file. Prefer an environment template, as in the example, or `apiKeyEnvar`.
- Model-graded tests and tool runs both add requests. Budget plugboard's app limits before a large run.

## Verified

Verified: run, 2026-10-13, against the live dev server with the example's two tests. Result: 2 of 2 passed, 0 failed, 0 errors. The text check got `pong`. The tool check got a tool call that passed `is-valid-openai-tools-call` and the JavaScript assertion. The grader output was truncated, so the call's arguments were not inspected. Total tokens 375.

- The run used a scratch copy of the example with `max_tokens: 1024` under `config`, because `fast` is a reasoning model. The example file itself was not changed, so it still has no `max_tokens`. Add it to the example if you want the same budget.
- Ran with `PROMPTFOO_DISABLE_TELEMETRY=1` and `PROMPTFOO_DISABLE_UPDATE=1`, and without `--share`.
- The promptfoo run sends no `n`. The dev server's `maxN` is 1, so a config that sets `n` above 1 gets `400 too_many_choices` there.
- Earlier, on 2026-10-12, the same config ran green against the scripted fake plugboard (the live server was not up then).
