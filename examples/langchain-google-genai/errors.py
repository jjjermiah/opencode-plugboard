"""E1 wrong key (401) and E2 unknown model (404). LangChain raises ChatGoogleGenerativeAIError with Google's error body in its message; the observations are the HTTP code and Google's status."""

import json
import re

from langchain_google_genai.chat_models import ChatGoogleGenerativeAIError

PROMPT = "Reply with exactly: pong"
FAKE_KEY = "sk-wrong-key-example"  # a fixed fake: it may appear in the run, the app key may not


def google_error(error: ChatGoogleGenerativeAIError) -> dict:
    """Reads `{'code': N, ..., 'status': 'NAME'}` out of the message: the body Google sends, which LangChain includes verbatim."""
    text = str(error)
    code = re.search(r"'code': (\d+)", text)
    status = re.search(r"'status': '([A-Z_]+)'", text)
    return {"status": int(code.group(1)) if code else None, "code": status.group(1) if status else None, "type": {"UNAUTHENTICATED": "authentication_error", "NOT_FOUND": "not_found_error"}.get(status.group(1)) if status else None}


def run_wrong_key(client, model):
    # region snippet-wrong-key
    try:
        client(model, api_key=FAKE_KEY).invoke(PROMPT)
    except ChatGoogleGenerativeAIError as error:
        return google_error(error)
    # endregion snippet-wrong-key
    raise AssertionError("a wrong key was accepted")


def run_unknown_model(client, _model):
    # region snippet-unknown-model
    try:
        client("nope").invoke(PROMPT)
    except ChatGoogleGenerativeAIError as error:
        return google_error(error)
    # endregion snippet-unknown-model
    raise AssertionError("an unknown model was accepted")


if __name__ == "__main__":
    from llm import chat_model

    print(json.dumps(run_wrong_key(chat_model, "fast")))
    print(json.dumps(run_unknown_model(chat_model, "nope")))
