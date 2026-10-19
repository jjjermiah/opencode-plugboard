# PR-Agent with plugboard

Points PR-Agent's OpenAI-like provider at plugboard and runs `/review` on a local branch. Full notes are in [docs/self-hosted/pr-agent.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/self-hosted/pr-agent.md).

## 1. Plugboard

Add the `pr-agent` key and the `review` alias from the page's plugboard options block. Bind an address that the PR-Agent runner can reach, set `keys`, then restart OpenCode.

## 2. PR-Agent

```sh
cp .env.example .env
# Set OPENAI__API_BASE to your plugboard address and OPENAI__KEY to the pr-agent app key.
```

Set the model in `configuration.toml`, as the page shows:

```toml
[config]
model = "openai/review"
fallback_models = ["openai/review"]
custom_model_max_tokens = 200000
```

Run PR-Agent the way the upstream docs describe (GitHub Action, webhook or CLI) with the variables from `.env`.

## 3. Check

```sh
curl -s http://192.0.2.10:4010/v1/models -H "Authorization: Bearer <the pr-agent app key>"
```

Then review a local branch with the `local` git provider. In a clean repository with the branch checked out and `main` as the target:

```sh
CONFIG__GIT_PROVIDER=local python -m pr_agent.cli --pr_url main review
```

The review is in `review.md`.

## Scripted run

`run.py` does the same in a throwaway repository against a scripted model, with the PR-Agent version pinned in `pyproject.toml` and `uv.lock`:

```sh
bun examples/_harness/run.ts pr-agent --target scripted
```

CI runs it and fails on a diff in `runs/scripted`.
