# pydantic-ai

Tested: `pydantic-ai-slim[openai]` 2.55.0 (Chat Completions API), `openai` 3.29.0. Live run [`2026-10-13-c97ac66-2`](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/pydantic-ai/runs/live/2026-10-13-c97ac66-2) at plugboard 0.26.0 (`c97ac66`): pass. One `ImageUrl` data URL answer on `fast` failed in run `2026-10-13-c97ac66` (verdict fail) and passed on the rerun with an identical request in `2026-10-13-c97ac66-2`, which is the run above. The code below is the example's snippet, and the run's summary and transcripts are in the example directory.

The snippets are the body of an `async` function that takes `client` (an `AsyncOpenAI` pointed at plugboard) and `model`. Set up the client and the imports like this, and run the function with `asyncio.run`:

```python
import asyncio
import os
from openai import AsyncOpenAI
from pydantic_ai import Agent
from pydantic_ai.models import ModelSettings
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

client = AsyncOpenAI(base_url="http://localhost:4010/v1", api_key=os.environ["PLUGBOARD_KEY"])
model = "fast"
```

`fast` is an alias from the plugboard `aliases` option. Use any allowed `provider/model[#variant]` instead.

## Chat

<<< @/../examples/pydantic-ai/chat.py#snippet

## Tool call

pydantic-ai runs the tool and makes the second request itself. The snippet uses `client`, `model`, and `PROMPT` (`"What is the weather in Paris? Use the tool."`) from the file's top.

<<< @/../examples/pydantic-ai/tools.py#snippet

## Structured output

`Agent(model, output_type=Meal)` (tool mode), `NativeOutput(Meal)` and `PromptedOutput(Meal)` all worked on three models. `PromptedOutput` sends `json_object` with the schema in the prompt, and `fast` returned numbers as strings once. Lax validation hid that. Prefer the default tool mode or `NativeOutput`. The snippet uses `client`, `model`, `PROMPT` and a `Meal` model (`calories: float`, `protein_g: float`) from the file's top.

<<< @/../examples/pydantic-ai/structured.py#snippet

## Gotchas

- Use `OpenAIChatModel`, the path this page was run on. `OpenAIResponsesModel` calls `/v1/responses`, which plugboard serves (see [Responses API](../responses.md)); it has not been run with pydantic-ai here.
- pydantic-ai always sends `stream_options.include_usage`, so streaming usage needs no setup.
- It has no list-models call. Use the provider's OpenAI client, `provider.client.models.list()`, with `provider` the `OpenAIProvider` you built.
- `openai_reasoning_effort` and `max_tokens` in model settings are accepted.
