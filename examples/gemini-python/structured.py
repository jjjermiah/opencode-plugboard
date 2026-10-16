"""S6, structured output: a JSON schema in the request, the answer read back as JSON."""

import json
import os

from google import genai
from google.genai import types


def run(client, model):
    # region snippet
    # Gemini enforces response_json_schema on the model's output, unlike plugboard's forced-tool route for other APIs.
    schema = {
        "type": "object",
        "properties": {"calories": {"type": "number"}, "protein_g": {"type": "number"}},
        "required": ["calories", "protein_g"],
        "additionalProperties": False,
    }
    response = client.models.generate_content(
        model=model,
        contents="Estimate: 2 boiled eggs and a slice of toast.",
        config=types.GenerateContentConfig(response_mime_type="application/json", response_json_schema=schema, max_output_tokens=1024),
    )
    # endregion snippet
    data = json.loads(response.text or "")
    return {
        "calories": data.get("calories"),
        "protein_g": data.get("protein_g"),
        "extra_keys": sorted(key for key in data if key not in ("calories", "protein_g")),
    }


if __name__ == "__main__":
    base_url = os.environ.get("PLUGBOARD_BASE_URL", "http://127.0.0.1:4010/v1").removesuffix("/v1")
    client = genai.Client(api_key=os.environ["PLUGBOARD_KEY"], http_options=types.HttpOptions(base_url=base_url))
    print(run(client, "fast"))
