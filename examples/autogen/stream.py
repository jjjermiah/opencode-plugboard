"""S3, streaming text. `llm_config(stream=True)` streams. AutoGen does not return the finish reason or usage, so the runner does not check them;
the harness decides from the captured stream whether it ended."""

from autogen import ConversableAgent

from llm import config


def run(model, route="chat"):
    cfg = config(model, route, stream=True)  # llm_config(stream=True)
    # region snippet
    streamer = ConversableAgent("streamer", llm_config=cfg, human_input_mode="NEVER")
    reply = streamer.generate_reply(messages=[{"role": "user", "content": "Reply with exactly: pong"}])
    # endregion snippet
    return {"text": str(reply).strip(), "done": True}


if __name__ == "__main__":
    import json

    print(json.dumps(run("fast")))
