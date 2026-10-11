# Agent mode: expose OpenCode agents as models

v0.1 serves raw models. The caller brings its own system prompt and tools, and OpenCode's agent configuration is out of the picture. People have asked for the opposite too: point a chat UI at an OpenCode agent (a code reviewer, a researcher with web access) and have it behave as configured.

## Design notes

List selected agents in `/v1/models` under a prefix such as `agent/<name>`, opt-in through an option like `agents: ["review", "research"]`. A request to one of them runs a normal OpenCode session in the app directory with that agent, instead of replacing system, messages and tools.

Open questions:

- Do the agent's tools run on the server, or are they returned to the caller? Server-side execution turns a chat endpoint into remote code execution for anyone holding a key, so this needs its own permission option and a conservative default (read-only tools only).
- How does a stateless chat transcript map onto a stateful session? Probably one session per conversation, keyed by a hash of the early messages or an explicit `user`/metadata field.
- Streaming should include tool progress only as text the client can ignore.

## Acceptance

- A configured agent shows up in `/v1/models` and answers a chat request with its own system prompt.
- An agent with no allowed tools never runs one.
- The permission model is documented in the README before this ships.
