# DSPy

DSPy reaches models through LiteLLM; the `openai/` prefix sends them to Chat Completions.

## Connect

<<< @/../examples/dspy/chat.py#snippet-lm

Put `api_base` on each `dspy.LM`, not in the model string. A second model needs its own `dspy.LM`.

## Predict and ChainOfThought

<<< @/../examples/dspy/chat.py#snippet

## Typed output

<<< @/../examples/dspy/typed.py#snippet

DSPy asks for its own text format first and falls back to a JSON schema when the text doesn't parse.

## Limits

- LiteLLM fetches its price map from GitHub on import. Set `LITELLM_LOCAL_MODEL_COST_MAP=True` to skip it.
