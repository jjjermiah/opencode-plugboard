# /// script
# requires-python = ">=3.12"
# dependencies = ["instructor==1.17.0", "openai>=2,<3"]
# ///
"""Instructor extraction on plugboard (#225): one validated Pydantic object.

    PLUGBOARD_URL=http://127.0.0.1:4010 PLUGBOARD_KEY=<app key> uv run example.py
"""

import os

import instructor
from openai import OpenAI
from pydantic import BaseModel, Field


class Person(BaseModel):
    name: str
    age: int = Field(ge=0, le=150)


base = os.environ.get("PLUGBOARD_URL", "http://127.0.0.1:4010").rstrip("/")
client = instructor.from_openai(OpenAI(base_url=f"{base}/v1", api_key=os.environ["PLUGBOARD_KEY"]), mode=instructor.Mode.TOOLS)

person = client.chat.completions.create(
    model="fast",
    response_model=Person,
    messages=[{"role": "user", "content": "Extract: Ada is 36 years old."}],
)
print(person)
