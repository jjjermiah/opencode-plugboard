# n8n

n8n's OpenAI Chat Model node, used by the Basic LLM Chain and the AI Agent.

## Connect

1. Create an "OpenAI API" credential: the API key is your plugboard key, and the Base URL is `http://127.0.0.1:4010/v1` (or `http://host.docker.internal:4010/v1` from the n8n container, which needs plugboard on a non-loopback address; see [Serving other machines](../guides/serving-other-machines.md)). Saving it calls `GET /v1/models`.
2. Add an OpenAI Chat Model node with that credential. If the model list shows only OpenAI names, switch Model to "By ID" and type an alias such as `fast` or any allowed `provider/model[#variant]`.
3. Turn **Use Responses API** off in the node. Chat Completions is the path to use from n8n.

## What works

- Basic LLM Chain and AI Agent, including tools (Code, Calculator, HTTP Request and others) and streaming webhooks. n8n runs the tools.
- The Structured Output Parser, which puts the schema in the prompt.

## Limits

- The node's "Response Format: JSON" sends `json_object` with no schema, so a weak model may return `{}`. Prefer the Structured Output Parser.
- Some providers reject sampling options (ChatGPT models reject `temperature` and `top_p`; Claude rejects `temperature` with `top_p`). Plugboard drops the ones it knows a model rejects and names them in `x-plugboard-dropped-params`. For others, n8n shows the provider's 400 as "Bad request": leave the option unset.
