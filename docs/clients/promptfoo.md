# promptfoo

Run 2026-10-12 against the scripted fake plugboard, not the live dev server (nothing listened on `127.0.0.1:4010`): promptfoo CLI 0.124.1 (npm `promptfoo`), `promptfoo eval --no-cache`. [examples/promptfoo/promptfooconfig.yaml](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/promptfoo) ran green: 2 of 2 passed, one plain-text check (`icontains pong`) and one tool-call check (`is-valid-openai-tools-call` plus a JavaScript assertion). `apiBaseUrl`, `apiKey`, `openai:chat:<model>` and the `tools` option were checked against promptfoo's OpenAI provider docs (promptfoo.dev/docs/providers/openai). The issue's claim that the provider reads `OPENAI_BASE_URL` is not in those docs and was not tested here.

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

Run against the fake, as above. The live dev server was not up, so a live eval is still open.
