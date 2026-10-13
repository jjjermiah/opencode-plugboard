# DSPy

<ExampleResult example="dspy" />

Tested: `dspy` 3.4.0 (with `litellm` 1.105.0 and `openai` 2.54.0). Live record [2026-10-12 at `a67e176`](https://github.com/jjjermiah/opencode-plugboard/blob/main/examples/dspy/runs/live/2026-10-12-a67e176/REPORT.md): all 3 scenarios passed on the isolated live dev server. `predict` and `chain-of-thought` answered `pong`, and the typed output returned `answer='42'`. The example's scripted run is checked in CI: 9 rows pass, and the rows it does not run are `n/a` with a reason. Streaming was not run.

DSPy routes its models through LiteLLM, and the `openai/` prefix sends them to Chat Completions. The `lm` below is the `dspy.LM` the example builds:

<<< @/../examples/dspy/chat.py#snippet-lm

`fast` is an alias from the plugboard `aliases` option. The `api_base` goes on `dspy.LM`, not in the model string.

## Chat

The snippet uses `lm` (above) and `dspy.configure(lm=lm)` must have run. It runs a `Predict` or a `ChainOfThought` depending on the variant.

<<< @/../examples/dspy/chat.py#snippet

## Typed output

The snippet defines its own `Signature` (an `answer` typed with a pydantic `Meal`), so it needs `dspy.configure(lm=...)` as above.

<<< @/../examples/dspy/typed.py#snippet

DSPy asks for the output in its own text format first, then falls back to a JSON schema when the text does not parse. The live record did not say which of DSPy's two formats the model used. The scripted run answers DSPy's own text format.

## Gotchas

- Pass `api_base` to each `dspy.LM`. A second model needs its own `dspy.LM`.
- Every test call used the `openai/` prefix.
- LiteLLM (under DSPy) reads its price map from GitHub on import. Set `LITELLM_LOCAL_MODEL_COST_MAP=True` to skip that, as the example does.
- The streaming and `dspy.streamify` paths were not tested.

Example: [`examples/dspy/`](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/dspy). The Python check it runs through is `examples/_harness/py`, the same helpers as the other Python examples.
