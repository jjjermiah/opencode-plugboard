# Compatibility harness for real OpenAI clients

"OpenAI-compatible" breaks at the edges: a client that sends `developer` messages, one that expects `usage` in the last chunk, one that streams tool call arguments in odd splits. Unit tests of our own parser won't find those. We need real clients run against a real endpoint, and a published list of what has passed.

## Design notes

A harness that starts a plugboard endpoint (a stub `ModelCaller` for fast runs, a real OpenCode server for the full run) and drives each client through one plain chat, one streamed chat, one tool round trip and one `json_schema` request.

Target list for v0.1, from the release gate: OpenAI SDK for Python and JS, Vercel AI SDK, LangChain, Open WebUI, n8n, curl golden fixtures, and pydantic-ai. pydantic-ai is the strict one: it validates tool call and usage shapes closely, so it is a good canary for the response encoder.

Open question: a separate workspace package in this repo, or its own repo. A package keeps fixtures next to the code. A separate repo keeps client dependencies (Python, Node, Docker for Open WebUI) out of the plugin. Start inside this repo and split only if the dependencies hurt.

The README's compatibility list should be generated from, or at least checked against, the harness results.

## Acceptance

- One command runs every listed client against a dev endpoint and prints pass or fail per scenario.
- Golden request and response fixtures are checked in for the curl cases.
- The README names only clients that pass.
