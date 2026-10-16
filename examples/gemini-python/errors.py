"""E1 wrong key (401) and E2 unknown model (404). The SDK raises ClientError; the observations are its code and Google's error status."""

import os

from google import genai
from google.genai import errors, types


def google_status(error: errors.APIError) -> str | None:
    """Google's error body is `{"error": {"code", "message", "status"}}`; the SDK keeps the parsed body in `details`."""
    body = error.details if isinstance(error.details, dict) else {}
    return (body.get("error") or {}).get("status")


def run_wrong_key(base_url, model):
    # region snippet-wrong-key
    # A fixed fake key: it may appear in the run, the app key may not.
    wrong = genai.Client(api_key="sk-wrong-key-example", http_options=types.HttpOptions(base_url=base_url))
    try:
        wrong.models.generate_content(model=model, contents="Reply with exactly: pong")
    except errors.ClientError as error:
        return {"status": error.code, "code": google_status(error), "type": {"UNAUTHENTICATED": "authentication_error", "NOT_FOUND": "not_found_error"}.get(google_status(error) or "")}
    # endregion snippet-wrong-key
    raise RuntimeError("a wrong key was accepted")


def run_unknown_model(client, model):
    # region snippet-unknown-model
    try:
        client.models.generate_content(model=model, contents="Reply with exactly: pong")
    except errors.ClientError as error:
        return {"status": error.code, "code": google_status(error), "type": {"UNAUTHENTICATED": "authentication_error", "NOT_FOUND": "not_found_error"}.get(google_status(error) or "")}
    # endregion snippet-unknown-model
    raise RuntimeError(f"model {model} was accepted")


if __name__ == "__main__":
    base_url = os.environ.get("PLUGBOARD_BASE_URL", "http://127.0.0.1:4010/v1").removesuffix("/v1")
    client = genai.Client(api_key=os.environ["PLUGBOARD_KEY"], http_options=types.HttpOptions(base_url=base_url))
    print(run_wrong_key(base_url, "fast"))
    print(run_unknown_model(client, "nope"))
