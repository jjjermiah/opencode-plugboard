# Red team

A red-team round is three agents (or people) who try to break plugboard before a user does. Each one has a role, a target, rules of engagement and a fixed way to report. Run a round after a release that changes request handling, and whenever you like. Everything a round needs is on this page, so anyone can repeat it.

## Targets

| Target | What it is | What is allowed |
| --- | --- | --- |
| Isolated dev server | A throwaway OpenCode server with plugboard loaded from a checkout, its own HOME and port ([development](development.md)) | Anything: floods, huge or slow bodies, malformed input, fuzzing, disconnects, config abuse. Restart it when it breaks. |
| A real deployment (the "hub") | The server real apps depend on | Realistic use only, through the dedicated `redteam` app, inside its limits. |

The hub runs real apps, so attacks there are limited by design. On the hub, the red team uses one app, `redteam`, set up like this:

```jsonc
"keys": { "redteam": "{env:PLUGBOARD_KEY_REDTEAM}" },
"apps": { "redteam": { "models": ["fast", "opencode-go/glm-5.3-flash", "anthropic/claude-haiku-4-5"] } },
"limits": { "apps": { "redteam": { "maxConcurrent": 2, "requestsPerMinute": 30 } } },
"budgets": { "apps": { "redteam": { "requests": { "day": 600 }, "tokens": { "day": 3000000 } } } }
```

`GET /v1/models` with the `redteam` key shows the app's models: `fast`, `opencode-go/glm-5.3-flash` and `anthropic/claude-haiku-4-5`, each with its `#` reasoning-effort variants. Read that list at the start of a round; it is the source of truth for what the key may call. All three are cheap models.

## Rules of engagement

On the dev server:

- Anything goes. Record the exact command for every finding, so it can be replayed.
- Restart the server when it breaks; a crash or a hang is a finding.

On the hub:

- Use only the `redteam` key. Never use or look for other apps' keys.
- No floods, no oversized bodies, no slow-reader or disconnect storms, no fuzzing. Those belong on the dev server.
- Use only the models the `redteam` key lists, and keep to the cheap ones unless a test needs another. Hitting the app's 429s or budget is expected: note it and slow down.
- Stop at once and report if the hub degrades: `/readyz` is not 200, `/healthz` fails, or latency jumps for a plain `fast` call.
- Don't change the hub's config, restart it, or touch its OpenCode sessions other than your own.

Everywhere:

- No secrets in reports. Redact keys to their first 6 characters.
- No real personal data in prompts.
- Clean up: delete the sessions you created on the dev server, and stop the containers and processes you started.

## Roles

Each role gets the brief below, plus the target URLs and keys. Run all three in parallel.

### 1. Attacker

Break the security model. Read `SECURITY.md` and the invariants in [architecture](architecture.md), then try to violate each one.

- **Authentication:** key handling (timing, wrong header forms, a revoked or rotated key, admin key reach), app isolation (read another app's usage or sessions), the keyless loopback mode, Host and Origin checks, DNS rebinding, CORS from a browser page.
- **Running things on the server:** tool execution (make OpenCode run a real tool for an app without `serverTools`), prompt injection that escapes the replaced system prompt, session and history leakage, path tricks in app names and `user` values.
- **Requests and resources:** SSRF through `remoteImages`, request smuggling, oversized or slow bodies, SSE backpressure, cache poisoning across apps, budget and limit bypass, log and header injection.
- **Plugboard's own pages:** dashboard XSS, its CSP, and the admin routes.

### 2. App builder

Build three small but real apps against plugboard with popular SDKs, as a new user would, following only the README and the docs site:

- a chat bot with tools and streaming
- a structured-extraction service
- a RAG-style app, where plugboard does the chat and you note what is missing for embeddings

Use at least three different client libraries across the three APIs (OpenAI, Anthropic, Gemini). Report:

- every point where you got stuck, the docs were wrong or unclear, an error was unhelpful, or behaviour surprised you
- missing features a real app needed
- client-library quirks

Time each step from "read README" to "first answer".

### 3. Protocol fuzzer

Check each API against its spec and its official SDK, on the dev server. Go through:

- request shapes valid by the spec but unusual: empty arrays, nulls, unicode, very long ids, every content-part type, every `tool_choice` form, `n`, stop sequences, every `response_format`, and parameters at their limits
- streaming event order and termination on every API
- errors before and after the response is committed
- usage numbers that are wrong or inconsistent between streamed and non-streamed answers
- cancellation mid-stream

Compare each answer with what the provider's real API would return for the same request, and with the vendored schemas in `test/fixtures/specs/`.

## Reporting

Every finding becomes a GitHub issue with the label `red-team`, plus `security` or `bug`:

- **Title:** `Red team: <what breaks>`
- **Body:**
  - target (dev server or hub) and plugboard version
  - exact steps or command to reproduce
  - expected and actual results
  - impact
  - a suggested fix, if you have one

For a suspected exploitable security issue on a released version, use private vulnerability reporting (`SECURITY.md`) instead of a public issue.

At the end, each agent writes a round report: what was tried, what held, what broke (with issue numbers), and what it could not test. Keep the reports under `.agents/research/` in the maintainer's workspace, or in an issue comment on the round's tracking issue.

## Running a round

1. Open a tracking issue: `Red team round <date>`, with the plugboard version on each target.
2. Check that the dev server answers the pong gate, and that the hub's `redteam` app answers `fast` within its limits.
3. Start the three roles with their briefs, the target URLs and the keys.
4. Triage each finding: confirm it, set its severity, and fix or defer it. Link the fixes in the tracking issue.
5. Close the round when every finding has a decision. Add the useful reproductions to the test suite, so the next round starts from what the last one found.
