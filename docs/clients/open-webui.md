# Open WebUI

Tested: Open WebUI 0.12.0 (Docker). Live run [`2026-10-13-0cf8030`](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/open-webui/runs/live/2026-10-13-0cf8030) at plugboard 0.28.0 (`0cf8030`): pass. S1 to S7 were driven over its HTTP API. A browser was not used, so dropdown behaviour with a long model list is unobserved. The run's summary and transcripts are in the example directory.

Add plugboard as an OpenAI connection, in the UI (Admin Panel, Settings, Connections, OpenAI API) or with the example's compose file, which sets the same connection by environment:

<<< @/../examples/open-webui/docker-compose.yml#snippet

Save it as `docker-compose.yml`, export `PLUGBOARD_KEY_OPEN_WEBUI` with the open-webui key, and run `docker compose up -d`.

The container example needs plugboard bound to a non-loopback address with `keys` set. A loopback bind is not reachable from a container, and its `Host` check would reject `host.docker.internal` anyway. See [reaching plugboard from another host or container](any-app.md#reaching-plugboard-from-another-host-or-container). Outside Docker use `http://localhost:4010/v1`. The example's README is [`examples/open-webui/README.md`](https://github.com/jjjermiah/opencode-plugboard/blob/main/examples/open-webui/README.md).

## Chat

Pick a model from the list (type `fast`, an alias from the plugboard `aliases` option) and send a message.

## Tool call

Enable a tool on the chat. Leave Function Calling at its default: in 0.12.0 anything but `legacy` is native, which sends real OpenAI `tools`. Open WebUI runs the tool itself and sends the result back. Both native and `legacy` (prompt-based) worked.

## Structured output

Open WebUI has no structured-output setting in its UI. Its API forwards `response_format` unchanged, and `json_schema` worked on three models.

## Gotchas

- Every UI chat request carries about 30 built-in tools, even with none selected. A plain "pong" chat sent `prompt_tokens` of about 5,500 against 17 on the bare API. Plugboard handled the schemas on all models tested.
- Each chat turn fires three extra requests after the answer, to the same model: follow-up questions, a title and tags. Each becomes a history session in plugboard. Turn those off in Open WebUI's task settings if the noise bothers you.
- The model list has several hundred entries when you allow whole providers. Narrow `models` to what you use.
- An unknown model is rejected by Open WebUI itself (`400 Model not found`) and never reaches plugboard.
- A wrong key shows plugboard's 401 body on the connection's verify button.
