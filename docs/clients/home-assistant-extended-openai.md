# Home Assistant: Extended OpenAI Conversation

The Extended OpenAI Conversation custom component (not core Home Assistant's OpenAI integration). It adds a **Base Url** to the OpenAI conversation agent and lets the model call Home Assistant services.

## Plugboard options

Home Assistant reaches plugboard over the LAN, so plugboard binds a reachable address with keys set ([Serving other machines](../guides/serving-other-machines.md)):

```jsonc
{
  "options": {
    "listen": { "host": "0.0.0.0", "port": 4010 },
    "keys": { "homeassistant": "{env:PLUGBOARD_KEY_HOMEASSISTANT}" },
    "models": ["anthropic/claude-sonnet-4-6"],
    "aliases": { "assist": "anthropic/claude-sonnet-4-6" },
    "apps": { "homeassistant": { "models": ["assist"] } }
  }
}
```

## Connect

1. Install the component from HACS (as a custom repository) and restart Home Assistant.
2. **Settings → Devices & Services → Add Integration → Extended OpenAI Conversation**: the `homeassistant` key as **API Key**, `http://192.0.2.10:4010/v1` (your plugboard host) as **Base Url**, **Skip Authentication** off.
3. In the integration's options, set **Chat model** to `assist`.
4. **Settings → Voice assistants**: pick **Extended OpenAI Conversation** as the conversation agent.
5. Expose the entities the model may control.

Setup checks the key and URL with `GET /v1/models`; a wrong chat model only fails on the first turn.

## What works

Conversation turns with streaming and service calls (Home Assistant runs them), and AI Task structured output.

## Limits

- Raise **Max tokens** above the default 500 for a model that reasons, or it may leave no visible answer.
- A custom **Functions** list replaces the default `execute_services` tool; copy it into your list to keep it.
- Don't give an alias a name starting with `gpt-5` or `o1`–`o4`: the component then changes which parameters it sends.
- To change the URL or key later, call the `extended_openai_conversation.change_config` service.
