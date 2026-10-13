"""S1, plain chat through DSPy: a Predict and a ChainOfThought on one question.

dspy.LM routes through LiteLLM with the `openai/` prefix, so the calls take the Chat Completions path. The snippet is
the program; `lm` (outside it) is the dspy.LM that run.py configures from PLUGBOARD_BASE_URL and PLUGBOARD_KEY.
finish_reason and usage come from the last call's response in `lm.history`, not from DSPy's output.
"""

import os

# The price map is bundled; without this LiteLLM fetches it from GitHub on import.
os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")

import dspy  # noqa: E402


# region snippet-lm
def lm_for(model: str) -> dspy.LM:
    return dspy.LM(f"openai/{model}", api_base=os.environ["PLUGBOARD_BASE_URL"], api_key=os.environ["PLUGBOARD_KEY"], cache=False)


# endregion snippet-lm


def last_response(lm: dspy.LM) -> dict:
    # DSPy 3.4 calls the provider through its own client, so each history entry holds a normalised Response (finish_reason)
    # and the call's usage counts.
    entry = lm.history[-1]
    return {"finish_reason": entry["response"].finish_reason, "usage": entry.get("usage") or None}


def run(model: str, variant: str) -> dict:
    lm = lm_for(model)
    dspy.configure(lm=lm)
    # region snippet
    if variant == "predict":
        out = dspy.Predict("question -> answer")(question="Reply with exactly: pong")
    else:
        out = dspy.ChainOfThought("question -> answer")(question="Reply with exactly: pong")
    # endregion snippet
    return {"text": out.answer, **last_response(lm)}
