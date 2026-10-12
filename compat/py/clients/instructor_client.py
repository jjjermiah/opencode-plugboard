"""Instructor (instructor, #225) against plugboard.

Instructor wraps the OpenAI client, so a custom base_url carries through. Scenarios: validated
extraction with the TOOLS mode (a forced tool call, the default for extraction), the JSON_SCHEMA
mode (response_format json_schema), and partial streaming with create_partial.
Run through `bun run compat:python`, or directly with PLUGBOARD_URL and PLUGBOARD_KEY set.
"""

import instructor
from _common import MODEL, api_key, base_url, main, require
from openai import OpenAI
from pydantic import BaseModel, Field

CLIENT = "instructor"


class Person(BaseModel):
    name: str
    age: int = Field(ge=0, le=150)


def client(mode: instructor.Mode) -> instructor.Instructor:
    return instructor.from_openai(OpenAI(base_url=base_url(), api_key=api_key()), mode=mode)


def tools_mode() -> str:
    person = client(instructor.Mode.TOOLS).chat.completions.create(
        model=MODEL, response_model=Person, messages=[{"role": "user", "content": "Extract: Ada is 36 years old."}], max_retries=0
    )
    require(isinstance(person, Person), f"got {type(person).__name__}")
    return f"parsed={person.model_dump()}"


def json_schema_mode() -> str:
    person = client(instructor.Mode.JSON_SCHEMA).chat.completions.create(
        model=MODEL, response_model=Person, messages=[{"role": "user", "content": "Extract: Ada is 36 years old."}], max_retries=0
    )
    require(isinstance(person, Person), f"got {type(person).__name__}")
    return f"parsed={person.model_dump()}"


def partial() -> str:
    updates = list(
        client(instructor.Mode.TOOLS).chat.completions.create_partial(
            model=MODEL, response_model=Person, messages=[{"role": "user", "content": "Extract: Ada is 36 years old."}], max_retries=0
        )
    )
    require(updates, "no partial objects")
    last = updates[-1]
    require(isinstance(last, Person), f"last partial is {type(last).__name__}")
    return f"partials={len(updates)} last={last.model_dump()}"


SCENARIOS = [
    ("tools-mode", tools_mode),
    ("json-schema-mode", json_schema_mode),
    ("partial-stream", partial),
]

if __name__ == "__main__":
    main(CLIENT, SCENARIOS)
