"""Runner for the PR-Agent example: `/review` of a local branch through plugboard. Started by examples/_harness/run.ts, which
captures the traffic and writes the run. This file writes nothing: it prints one JSON line per scenario and model.

    uv run --frozen run.py          # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness

The scenario is S9. The runner builds a throwaway git repo with a `main` branch and a feature branch, then runs the pinned
PR-Agent CLI in it with `config.git_provider=local`. That provider reviews the checked-out branch against `main` and writes
`review.md`. The runner reads the file, and reads the request plugboard saw from the capture proxy.
"""

import json
import os
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "_harness" / "py"))

import harness  # noqa: E402

# The finding the scripted model returns (PR_REVIEW in examples/_harness/scripted-model.ts).
SCRIPTED_FINDING = "The scripted model reviewed this diff and found nothing to change."

# LiteLLM reads its bundled price map instead of fetching one from GitHub, so the run needs no other network than plugboard.
os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"


def git(repo: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True)


def make_repo(repo: Path) -> None:
    """A `main` branch with one file, and `feature/greeting` one commit ahead of it."""
    git(repo, "init", "-q", "-b", "main")
    git(repo, "config", "user.email", "check@example.invalid")
    git(repo, "config", "user.name", "check")
    (repo / "hello.py").write_text('print("hi")\n')
    git(repo, "add", "hello.py")
    git(repo, "commit", "-qm", "Add hello.py")
    git(repo, "checkout", "-q", "-b", "feature/greeting")
    (repo / "hello.py").write_text('print("hi")\nprint("hello, world")\n')
    git(repo, "commit", "-qam", "Greet the world")


def own_exchanges() -> list[dict]:
    """The exchanges the capture proxy saw since the scenario mark: path, status and plugboard's reply."""
    with urllib.request.urlopen(f"{os.environ['PLUGBOARD_CAPTURE_URL']}/__exchanges", timeout=60) as response:
        return json.load(response)


def s9(model: str) -> dict:
    with tempfile.TemporaryDirectory() as directory:
        repo = Path(directory)
        make_repo(repo)
        # region snippet
        env = {
            **os.environ,
            "CONFIG__GIT_PROVIDER": "local",
            "OPENAI__API_BASE": os.environ["PLUGBOARD_BASE_URL"],
            "OPENAI__KEY": os.environ["PLUGBOARD_KEY"],
            "CONFIG__MODEL": f"openai/{model}",
            "CONFIG__FALLBACK_MODELS": json.dumps([f"openai/{model}"]),
            "CONFIG__CUSTOM_MODEL_MAX_TOKENS": "200000",
        }
        # Run from inside the repo. The local provider takes the target branch where the other providers take a pull request URL.
        run = subprocess.run([sys.executable, "-m", "pr_agent.cli", "--pr_url", "main", "review"], cwd=repo, env=env, capture_output=True, text=True)
        # endregion snippet
        if run.returncode != 0:
            raise RuntimeError(f"pr_agent.cli exited {run.returncode}: {run.stderr[-500:]}")
        review = repo / "review.md"
        text = review.read_text(encoding="utf-8") if review.exists() else ""
    sent = [exchange for exchange in own_exchanges() if exchange["status"] == 200]
    reply = json.loads(sent[0]["resBody"]) if len(sent) == 1 else {}
    return {
        "review_written": bool(text.strip()),
        "review_has_scripted_text": SCRIPTED_FINDING in text,
        "request_route": sent[0]["path"] if len(sent) == 1 else None,
        "request_model": reply.get("model"),
    }


def main() -> None:
    harness.emit_client("pr-agent")
    harness.run_all({"S9": s9})


if __name__ == "__main__":
    main()
