# pydantic-ai

pydantic-ai with `OpenAIChatModel`. For Claude through the Messages API, see [pydantic-ai (Anthropic)](pydantic-ai-anthropic.md).

## Connect

```python
import os
from openai import AsyncOpenAI
from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

client = AsyncOpenAI(base_url="http://127.0.0.1:4010/v1", api_key=os.environ["PLUGBOARD_KEY"])
model = OpenAIChatModel("fast", provider=OpenAIProvider(openai_client=client))
```

`"fast"` is an alias from your `aliases` option; any allowed `provider/model[#variant]` works too. `OpenAIResponsesModel` works the same way on the Responses API.

## Chat

<<< @/../examples/pydantic-ai/chat.py#snippet

## Tool calls

pydantic-ai runs the tool and makes the follow-up request itself.

<<< @/../examples/pydantic-ai/tools.py#snippet

## Structured output

Use the default tool mode (`Agent(model, output_type=Meal)`) or `NativeOutput(Meal)`. `PromptedOutput` sends no schema to the model, so a weak model may return numbers as strings.

<<< @/../examples/pydantic-ai/structured.py#snippet

## Limits

- No model-list call. Use the provider's client: `provider.client.models.list()`.
