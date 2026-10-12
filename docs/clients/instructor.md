# Instructor

Tested: `instructor` 1.17.0 (with `openai` 2.54.0, from `compat/py-litellm`), 2026-10-12, against the scripted fake plugboard. Validated extraction in TOOLS and JSON_SCHEMA mode, and partial streaming, passed. The same day, all 3 scenarios also passed on the isolated live dev server (`fast` = `opencode-go/glm-5.3-flash`, extracting "Ada, 36" correctly); see [compatibility](../compatibility.md#python-clients).

Instructor wraps the OpenAI client and returns a validated Pydantic object instead of a completion.

```python
import os
import instructor
from openai import OpenAI
from pydantic import BaseModel, Field

class Person(BaseModel):
    name: str
    age: int = Field(ge=0, le=150)

client = instructor.from_openai(
    OpenAI(base_url="http://localhost:4010/v1", api_key=os.environ["PLUGBOARD_KEY"]),
    mode=instructor.Mode.TOOLS,
)
person = client.chat.completions.create(
    model="fast",                                   # an alias from the plugboard `aliases` option
    response_model=Person,
    messages=[{"role": "user", "content": "Extract: Ada is 36 years old."}],
)
print(person)
```

`instructor.from_provider("openai/fast", base_url=..., api_key=...)` is the other entry point in the client docs; it was not run here.

## Modes

| Mode | What plugboard receives | Result in the fake run |
|---|---|---|
| `Mode.TOOLS` | a tool built from the model, forced by `tool_choice` | pass |
| `Mode.JSON_SCHEMA` | `response_format` with `json_schema` (plugboard turns it into a forced tool) | pass |

Partial streaming: `client.chat.completions.create_partial(...)` yields growing objects. The fake sends a tool call's arguments in one delta, so the run gave one partial, the full object. Streams where the arguments arrive in many pieces were not tested.

## Gotchas

- Plugboard does not enforce the schema. A model can return a value that fails validation, and Instructor then retries. Keep `max_retries` above 0 for real use; the harness set it to 0 so that a failure shows.
- Do not pass both a `tools` list and a `response_model` in one request. The client issue for this (#225) reports that plugboard then returns the caller's tool calls, not the schema answer. Not re-tested here.
- The fake always returns values that match the schema, so the harness proves the wiring, not that a model fills the fields correctly.

Harness: `compat/py/clients/instructor_client.py`. Example: [`examples/instructor/`](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/instructor).
