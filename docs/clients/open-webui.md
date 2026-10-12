# Open WebUI

Tested: Open WebUI 0.12.0 (Docker), 2026-10-11, at an earlier commit. S1 to S7 passed, driven over its HTTP API. A browser was not used, so dropdown behaviour with a long model list is unobserved. S6 was a direct API call, and on `fast` the S5 image answer was "Crimson" rather than "red".

Add plugboard as an OpenAI connection, in the UI (Admin Panel, Settings, Connections, OpenAI API) or by environment:

```sh
docker run -d --name open-webui -p 127.0.0.1:3000:8080 \
  --add-host host.docker.internal:host-gateway \
  -e OPENAI_API_BASE_URL=http://host.docker.internal:4010/v1 \
  -e OPENAI_API_KEY="$PLUGBOARD_KEY" \
  -e ENABLE_OLLAMA_API=false \
  -v open-webui:/app/backend/data \
  ghcr.io/open-webui/open-webui:0.12.0
```

The container example needs plugboard bound to a non-loopback address with `keys` set. A loopback bind is not reachable from a container, and its `Host` check would reject `host.docker.internal` anyway. See [reaching plugboard from another host or container](any-app.md#reaching-plugboard-from-another-host-or-container). Outside Docker use `http://localhost:4010/v1`. The test setup is in [compat/docker/README.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/compat/docker/README.md).

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
