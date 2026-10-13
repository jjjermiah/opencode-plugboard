# compat (remaining checks)

The client checks moved to [`examples/`](../examples/README.md): each client has a runnable example, a scripted run that CI keeps current, and its live runs. What is left here has no example replacement yet:

- `py/clients/`: the Python checks for aider (`aider_check.sh`), DSPy, Instructor, LiteLLM and the OpenAI Agents SDK, run by `run_all.py` (`bun run compat:python`). Their examples (`examples/aider`, `dspy`, `instructor`, `litellm-client`, `openai-agents`) are PEP 723 scripts, not harness runs.
- `py/` (`pyproject.toml`, `uv.lock`) and `py-litellm/` (`uv.lock` for DSPy, Instructor and LiteLLM): the pins those checks use.

Their dated records are in `examples/<client>/runs/live/`. Do not add a check here: add an example. Moving them into the harness is tracked in [#366](https://github.com/jjjermiah/opencode-plugboard/issues/366).
