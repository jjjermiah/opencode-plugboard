"""S1, plain chat, non-stream. AutoGen does not return the finish reason, so the runner does not check it."""

from autogen import ConversableAgent

from llm import config


def run(model, route="chat"):
    cfg = config(model, route)  # llm_config() on the chat route, anthropic_config() on the messages route
    # region snippet
    bot = ConversableAgent("bot", llm_config=cfg, human_input_mode="NEVER")
    reply = bot.generate_reply(messages=[{"role": "user", "content": "Reply with exactly: pong"}])
    # endregion snippet
    return {"text": str(reply).strip(), "usage": bot.get_total_usage()}


if __name__ == "__main__":
    import json

    print(json.dumps(run("fast")))
