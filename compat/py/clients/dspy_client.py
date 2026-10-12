"""DSPy (dspy, #224) against plugboard.

dspy.LM routes through LiteLLM with the `openai/` prefix, so the calls take the Chat Completions
path. Scenarios: a plain Predict, ChainOfThought, and a typed output (a pydantic model, which DSPy
asks the model for through a JSON schema).
Run through `bun run compat:python`, or directly with PLUGBOARD_URL and PLUGBOARD_KEY set.
"""

import os

os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")

import dspy  # noqa: E402
from _common import MODEL, api_key, base_url, main, require  # noqa: E402
from pydantic import BaseModel  # noqa: E402

CLIENT = "dspy"


class Answer(BaseModel):
    answer: str


def configure() -> None:
    lm = dspy.LM(f"openai/{MODEL}", api_base=base_url(), api_key=api_key(), cache=False)
    dspy.configure(lm=lm)


def predict() -> str:
    configure()
    out = dspy.Predict("question -> answer")(question="Reply with exactly: pong")
    require(out.answer and "pong" in out.answer.lower(), f"answer={out.answer!r}")
    return f"answer={out.answer!r}"


def chain_of_thought() -> str:
    configure()
    out = dspy.ChainOfThought("question -> answer")(question="Reply with exactly: pong")
    require(out.answer and "pong" in out.answer.lower(), f"answer={out.answer!r}")
    return f"answer={out.answer!r} reasoning_fields={'reasoning' in out.keys()}"


def typed() -> str:
    configure()
    class QA(dspy.Signature):
        """Answer the question."""

        question: str = dspy.InputField()
        answer: Answer = dspy.OutputField()

    out = dspy.Predict(QA)(question="What is 6 times 7?")
    require(isinstance(out.answer, Answer), f"answer is {type(out.answer).__name__}: {out.answer!r}")
    return f"answer={out.answer.model_dump()}"


SCENARIOS = [
    ("predict", predict),
    ("chain-of-thought", chain_of_thought),
    ("typed-output", typed),
]

if __name__ == "__main__":
    main(CLIENT, SCENARIOS)
