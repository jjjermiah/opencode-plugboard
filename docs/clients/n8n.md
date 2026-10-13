# n8n

Tested: n8n 2.42.6 (Docker), OpenAI Chat Model node v1.3. Live run [`2026-10-13-b92fb6f`](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/n8n/runs/live/2026-10-13-b92fb6f) at plugboard 0.29.0 (`b92fb6f`): partial. The run's report and transcripts are in the example directory. S1 to S7 were driven headless through webhooks. The "Response Format: JSON" check on `fast` was flaky (see Structured output), and the Responses API default and some sampling options failed (see Gotchas).

## Setup

1. Credentials, create "OpenAI API": API Key is your plugboard key, **Base URL** is `http://host.docker.internal:4010/v1` from a container or `http://localhost:4010/v1` from a host install. The container case needs plugboard bound to a non-loopback address with `keys` set, see [reaching plugboard from another host or container](any-app.md#reaching-plugboard-from-another-host-or-container). Saving runs `GET /v1/models`.
2. Add an OpenAI Chat Model node with that credential. If the model dropdown only lists OpenAI names, switch Model to "By ID" and type `fast`, an alias from the plugboard `aliases` option, or any allowed `provider/model[#variant]`.
3. In the node, turn **Use Responses API off** (tested). The Responses path is served too, but untested in n8n.

## Chat

Basic LLM Chain with the Chat Model node attached. Sent as plain `{model, stream:false, messages}`.

## Tool call

AI Agent with the Chat Model node and any tool (Code, Calculator, Date & Time). n8n runs the tool and sends the result back. Streaming worked with a streaming webhook.

## Structured output

The Structured Output Parser works on all three models tested. It puts the schema in the prompt, so no `response_format` is sent. The Chat Model's "Response Format: JSON" option sends `json_object` with no schema, and a weak model may return `{}` or numbers as strings.

## Gotchas

- **Use Responses API is on by default** in the Chat Model node, even with a custom Base URL. n8n then calls `POST /v1/responses`. Plugboard serves it now (see [Responses API](../responses.md)), but this page's checks were run with the toggle off, and the Responses path has not been run through n8n. Leave the toggle off unless you have tried it. The same goes for the OpenAI vendor node ("Message a Model"), which was not tested.
- Providers reject some sampling options: ChatGPT ids return 400 `Unsupported parameter: temperature` (and `top_p`, both penalties), some models reject `frequency_penalty` or `presence_penalty`, and Claude rejects `temperature` together with `top_p` (newer Claude models reject both). Plugboard drops the ones it knows the model rejects and lists them in the response header `x-plugboard-dropped-params`. A model it does not know still gets them as set, and n8n shows the provider's 400 as "Bad request"; then leave the option unset. The `dropUnsupportedParams` plugin option turns the dropping off. `Max Tokens` is fine.
