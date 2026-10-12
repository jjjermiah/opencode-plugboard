# /// script
# requires-python = ">=3.12"
# dependencies = ["dspy==3.4.0"]
# ///
"""A DSPy program on plugboard (#224): ChainOfThought with a typed output.

    PLUGBOARD_URL=http://127.0.0.1:4010 PLUGBOARD_KEY=<app key> uv run example.py
"""

import os

os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")  # use the bundled price map; no fetch on import

import dspy  # noqa: E402
from pydantic import BaseModel  # noqa: E402


class Answer(BaseModel):
    answer: str


class QA(dspy.Signature):
    """Answer the question."""

    question: str = dspy.InputField()
    answer: Answer = dspy.OutputField()


base = os.environ.get("PLUGBOARD_URL", "http://127.0.0.1:4010").rstrip("/")
dspy.configure(lm=dspy.LM("openai/fast", api_base=f"{base}/v1", api_key=os.environ["PLUGBOARD_KEY"]))

out = dspy.ChainOfThought(QA)(question="What is 6 times 7?")
print(out.answer)
