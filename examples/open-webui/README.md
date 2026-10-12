# Open WebUI with plugboard

Runs [Open WebUI](https://github.com/open-webui/open-webui) in Docker and points its OpenAI connection at plugboard on the host. The chat models are the ones your OpenCode server is signed in to, and plugboard's `fast` alias picks the default.

Tested against Open WebUI 0.12.0: see [docs/clients/open-webui.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/clients/open-webui.md) for what passed and the gotchas (about 30 built-in tools per request, extra title and tag requests per turn).

## 1. Plugboard options

Plugboard must accept connections from the container, so it binds a non-loopback address and needs a key. Add this to the plugin entry in `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "plugins": [
    {
      "package": "opencode-plugboard@0.18.0",
      "options": {
        // Reachable from the container. Bind the docker bridge address (`ip addr show docker0`)
        // or 0.0.0.0, and keep the host firewall closed to everything else.
        "listen": { "host": "0.0.0.0", "port": 4010 },
        "keys": { "open-webui": "{env:PLUGBOARD_KEY_OPEN_WEBUI}" },
        "models": ["opencode-go/glm-5.3-flash"],
        "aliases": { "fast": "opencode-go/glm-5.3-flash" }
      }
    }
  ]
}
```

Every alias target must also be in `models`. Replace the model with one you are signed in to. A non-loopback bind takes effect after an OpenCode restart, and the key is plain HTTP on the wire, so keep this on a network you trust (see [reaching plugboard from another host or container](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/clients/any-app.md#reaching-plugboard-from-another-host-or-container)).

## 2. Key

Pick a long random key and export it in the shell that runs Docker Compose. It must equal the `open-webui` value in the options above:

```sh
export PLUGBOARD_KEY_OPEN_WEBUI="$(openssl rand -hex 32)"
```

## 3. Start Open WebUI

```sh
cd examples/open-webui
docker compose up -d
```

Open http://127.0.0.1:3000, create the admin account, and pick `fast` in the model list. The compose file sets `DEFAULT_MODELS` to `fast`, so new chats start on it.

Check the connection from the host before you open the UI:

```sh
curl -s http://127.0.0.1:4010/healthz
curl -s http://127.0.0.1:4010/v1/models -H "Authorization: Bearer $PLUGBOARD_KEY_OPEN_WEBUI"
```
