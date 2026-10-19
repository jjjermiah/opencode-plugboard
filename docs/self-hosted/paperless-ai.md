# paperless-ai

paperless-ai runs beside paperless-ngx. An LLM suggests titles, tags, correspondents and document dates, and there is a chat over your documents. It reads and writes paperless-ngx through its API.

## Plugboard options

Give paperless-ai its own key and a text alias. It sends no images, so you need no vision alias. Docker needs a reachable address ([Serving other machines](../guides/serving-other-machines.md)).

```jsonc
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "paperless-ai": "{env:PLUGBOARD_KEY_PAPERLESS_AI}" },
    "models": ["opencode-go/glm-5.3-flash"],
    "aliases": { "text": "opencode-go/glm-5.3-flash" },
    "apps": { "paperless-ai": { "models": ["text"] } }
  }
}
```

## Connect

paperless-ai reads environment variables and `data/.env` in its data volume:

```sh
AI_PROVIDER=custom
CUSTOM_BASE_URL=http://host.docker.internal:4010/v1
CUSTOM_API_KEY=<the paperless-ai key>
CUSTOM_MODEL=text
PAPERLESS_API_URL=http://<paperless-ngx host>:8000/api
PAPERLESS_API_TOKEN=<your paperless-ngx API token>
```

`CUSTOM_BASE_URL` ends in `/v1`. `CUSTOM_API_KEY` takes the plugboard key.

A runnable copy is in [`examples/self-hosted/paperless-ai/`](https://github.com/jjjermiah/opencode-plugboard/blob/main/examples/self-hosted/paperless-ai/README.md).

## What works

- Suggestions for title, tags, correspondent, document date and language.
- Streaming chat.
- RAG answers. Plugboard writes the answer. Retrieval and reranking run locally in paperless-ai.

## Limits

- Suggestions need a JSON object in the reply. If the model wraps it in extra text, the document gets no suggestion and the log shows `Invalid JSON response from API`. Use a model that follows the format.
- The RAG service downloads its two local models from Hugging Face on first start. A host with no Hugging Face access needs them cached first.
- The playground sends `max_tokens: 128000`. Plugboard passes it on, so the target model decides whether it is accepted.
- Settings saved in the web UI are lost when the container is recreated, because the compose `env_file` values win. Change provider settings in `.env` and recreate the container.
- While `PAPERLESS_AI_INITIAL_SETUP=yes`, the setup route is open to anyone who reaches the port. Bind the port to loopback or a trusted network.
- paperless-ai's repository says it is not currently maintained. Pin the image to a tag or digest you have tested.
