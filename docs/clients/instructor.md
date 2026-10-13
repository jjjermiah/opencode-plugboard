# Instructor

<ExampleResult example="instructor" />

Tested: `instructor` 1.17.0 (with `openai` 2.54.0). Live record [2026-10-12 at `a67e176`](https://github.com/jjjermiah/opencode-plugboard/blob/main/examples/instructor/runs/live/2026-10-12-a67e176/REPORT.md): all 3 scenarios passed on the isolated live dev server (`fast` = `opencode-go/glm-5.3-flash`, extracting "Ada, 36" correctly). The example's scripted run is checked in CI: the three modes pass.

Instructor wraps the OpenAI client and returns a validated Pydantic object instead of a completion. The example's client is the OpenAI client for plugboard:

<<< @/../examples/instructor/structured.py#snippet-client

`fast` is an alias from the plugboard `aliases` option.

## Modes

The example runs the same structured-output scenario in three modes. Each snippet builds `client` for its mode and returns the validated Meal.

| Mode | What plugboard receives | Result in the scripted run |
|---|---|---|
| `Mode.TOOLS` | a tool built from the model, forced by `tool_choice` | pass |
| `Mode.JSON_SCHEMA` | `response_format` with `json_schema` (plugboard turns it into a forced tool) | pass |
| partial stream (`create_partial`) | a streamed tool call; the last partial is the full object | pass |

The `Mode.TOOLS` snippet:

<<< @/../examples/instructor/structured.py#snippet-tools

The `Mode.JSON_SCHEMA` snippet:

<<< @/../examples/instructor/structured.py#snippet-json-schema

Partial streaming, with `client.chat.completions.create_partial(...)`, which yields growing objects:

<<< @/../examples/instructor/structured.py#snippet-partial

The example's `Meal` model forbids extra keys, so `extra_keys` in the run is always empty. The check is the model's own validation, not a count of keys in the raw answer.

## Gotchas

- Plugboard does not enforce the schema. A model can return a value that fails validation, and Instructor then retries. Keep `max_retries` above 0 for real use; the example sets it to 0 so that a failure shows.
- Do not pass both a `tools` list and a `response_model` in one request. Plugboard issue #34 reports that plugboard then returns the caller's tool calls, not the schema answer. Not re-tested here.
- The scripted run answers with values that match the schema, so it proves the wiring, not that a model fills the fields correctly.

Example: [`examples/instructor/`](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/instructor).
