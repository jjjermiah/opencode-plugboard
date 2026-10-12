"""Runs every Python client harness: `bun run compat:python`.

With PLUGBOARD_URL unset, starts the scripted fake server (`test/support/fake-server.ts`) and runs
against it. With PLUGBOARD_URL and PLUGBOARD_KEY set, runs against that server instead (the live
dev server, see docs/development.md). Prints each harness's JSON lines, then a summary; exits 1 if
any scenario failed.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
# (uv project under compat/, harness file). litellm needs openai<3, the Agents SDK needs openai>=3,
# so they run in separate environments; see compat/py-litellm/pyproject.toml.
HARNESSES = [("py", "openai_agents.py"), ("py-litellm", "litellm_client.py")]


def start_fake() -> tuple[subprocess.Popen[str], str, str]:
    proc = subprocess.Popen(
        ["bun", str(REPO / "test/support/fake-server.ts")],
        cwd=REPO,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    assert proc.stdout is not None
    values = {}
    for _ in range(2):
        line = proc.stdout.readline()
        name, _, value = line.strip().partition("=")
        values[name] = value
    return proc, values["PLUGBOARD_URL"], values["PLUGBOARD_KEY"]


def stop_fake(proc: subprocess.Popen[str]) -> None:
    assert proc.stdin is not None
    proc.stdin.close()  # the fake stops when its stdin ends
    proc.wait(timeout=10)


def main() -> int:
    proc = None
    env = dict(os.environ)
    env.pop("VIRTUAL_ENV", None)  # the parent's env would make each child uv run warn
    if not env.get("PLUGBOARD_URL"):
        proc, url, key = start_fake()
        env.update(PLUGBOARD_URL=url, PLUGBOARD_KEY=key)
        print(f"fake plugboard at {url}", file=sys.stderr)
    else:
        print(f"live plugboard at {env['PLUGBOARD_URL']}", file=sys.stderr)
    tally = {"pass": 0, "fail": 0}
    try:
        for project, name in HARNESSES:
            command = ["uv", "run", "--project", str(REPO / "compat" / project), "python", str(HERE / name)]
            run = subprocess.run(command, env=env, capture_output=True, text=True, cwd=HERE)
            sys.stdout.write(run.stdout)
            sys.stderr.write(run.stderr)
            rows = [json.loads(line) for line in run.stdout.splitlines() if line.startswith("{")]
            for row in rows:
                tally[row["status"]] = tally.get(row["status"], 0) + 1
            if run.returncode != 0 and not rows:
                # crashed before any scenario ran (import error, missing env): count it as a failure
                tally["fail"] += 1
                print(json.dumps({"client": name, "scenario": "harness", "status": "fail", "detail": f"exit {run.returncode}, no scenario ran"}), flush=True)
    finally:
        if proc is not None:
            stop_fake(proc)
    print(f"SUMMARY pass={tally.get('pass', 0)} fail={tally.get('fail', 0)}", file=sys.stderr)
    return 1 if tally.get("fail", 0) else 0


if __name__ == "__main__":
    sys.exit(main())
