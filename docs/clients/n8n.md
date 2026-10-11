# n8n

Tested: n8n 2.42.6 (Docker), OpenAI Chat Model node v1.3, 2026-10-11. S1 to S7 passed, driven headless through webhooks.

## Setup

1. Credentials, create "OpenAI API": API Key is your plugboard key, **Base URL** is `http://host.docker.internal:4010/v1` from a container (see [compat/docker/README.md](../../compat/docker/README.md)) or `http://localhost:4010/v1` from a host install. Saving runs `GET /v1/models`.
2. Add an OpenAI Chat Model node with that credential. If the model dropdown only lists OpenAI names, switch Model to "By ID" and type `fast`, an alias from the plugboard `aliases` option, or any allowed `provider/model[#variant]`.
3. In the node, turn **Use Responses API off**.

## Chat

Basic LLM Chain with the Chat Model node attached. Sent as plain `{model, stream:false, messages}`.

## Tool call

AI Agent with the Chat Model node and any tool (Code, Calculator, Date & Time). n8n runs the tool and sends the result back. Streaming worked with a streaming webhook.

## Structured output

The Structured Output Parser works on all three models tested. It puts the schema in the prompt, so no `response_format` is sent. The Chat Model's "Response Format: JSON" option sends `json_object` with no schema, and a weak model may return `{}` or numbers as strings.

## Gotchas

- **Use Responses API is on by default** in the Chat Model node, even with a custom Base URL. n8n then calls `POST /v1/responses`, which plugboard does not serve yet, and the run fails with `No route for POST /v1/responses`. Turn it off. The same goes for the OpenAI vendor node ("Message a Model"), which was not tested.
- Sampling options are forwarded as set, and providers reject some: ChatGPT ids return 400 `Unsupported parameter: temperature` (and `top_p`, both penalties), some models reject `frequency_penalty` or `presence_penalty`, and Claude rejects `temperature` together with `top_p`. n8n shows these as "Bad request". Leave the options unset unless you need them. `Max Tokens` is fine.
