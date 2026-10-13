# DSPy

Tested: `dspy` 3.4.0 (with `litellm` 1.105.0 and `openai` 2.54.0, from `compat/py-litellm`), 2026-10-12. Live on the isolated dev server (`fast` = `opencode-go/glm-5.3-flash`): all 3 scenarios passed. `predict` and `chain-of-thought` answered `pong`, and the typed output returned `answer='42'`. Streaming was not run. The same 3 scenarios pass on the scripted fake. See [compatibility](../compatibility.md#python-clients).

DSPy routes its models through LiteLLM. The `openai/` prefix sends them to Chat Completions.

```python
import os
import dspy

lm = dspy.LM("openai/fast", api_base="http://localhost:4010/v1", api_key=os.environ["PLUGBOARD_KEY"])
dspy.configure(lm=lm)

qa = dspy.Predict("question -> answer")
print(qa(question="Reply with exactly: pong").answer)
```

`fast` is an alias from the plugboard `aliases` option. The `api_base` goes on `dspy.LM`, not in the model string.

## Typed output

```python
from pydantic import BaseModel

class Answer(BaseModel):
    answer: str

class QA(dspy.Signature):
    """Answer the question."""
    question: str = dspy.InputField()
    answer: Answer = dspy.OutputField()

out = dspy.ChainOfThought(QA)(question="What is 6 times 7?")
print(out.answer)  # an Answer
```

DSPy asks for the output in its own text format first, then falls back to a JSON schema when the text does not parse. The typed run passed on the fake, which answers the JSON form, and live, where the model returned `answer='42'`. The live run did not record which of DSPy's two formats the model used, so whether the live model took the JSON fallback is not shown.

## Gotchas

- Pass `api_base` to each `dspy.LM`. A second model needs its own `dspy.LM`.
- Every test call used the `openai/` prefix.
- LiteLLM (under DSPy) reads its price map from GitHub on import. Set `LITELLM_LOCAL_MODEL_COST_MAP=True` to skip that, as the harness and example do.
- The streaming and `dspy.streamify` paths were not tested.

Harness: `compat/py/clients/dspy_client.py`. Example: [`examples/dspy/`](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/dspy).
