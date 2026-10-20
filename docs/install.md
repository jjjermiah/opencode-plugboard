# Install and first request

Three steps: add the plugin, restart OpenCode, call it. You need OpenCode V2 (2.0.26 or later) with at least one provider login, and [Bun](https://bun.sh).

## 1. Add the plugin

```sh
bunx opencode-plugboard init
```

This adds plugboard to your global config, `~/.config/opencode/opencode.jsonc`, pinned to the current release. It creates a key for one app (`my-app`; pick the name with `--app`), allows every model of every provider you are logged in to, and prints the key once with a ready curl. A config file it creates is readable by you alone (mode 0600, and 0700 for a directory it makes), because the key is in it; a file that already exists keeps its mode.

- `--fast <model>` adds a `fast` alias, for example `--fast anthropic/claude-haiku-4-5`.
- `--dry-run` shows the change without writing it.
- An existing plugboard entry is kept unless you pass `--force`.
- The key is stored in the file, so keep the file private.

### Or write the entry yourself

Plugboard keys are its own, not provider keys or the OpenCode server password. Keep the plugin in the global config: every project loads it.

```jsonc
{
  "plugins": [
    {
      "package": "opencode-plugboard@__PLUGBOARD_VERSION__",
      "options": {
        "keys": { "my-app": "{env:PLUGBOARD_KEY_MY_APP}" },
        "models": ["anthropic/claude-sonnet-4-6", "github-copilot/*", "opencode-go/glm-5.3-flash"],
        "aliases": { "fast": "opencode-go/glm-5.3-flash" }
      }
    }
  ]
}
```

- `keys` names each app and gives it a key. `{env:VAR}` is read from the environment OpenCode starts from, so the key stays out of the file.
- `models` is the allowlist. `"connected"` allows every model of every provider you are logged in to, including ones you connect later. A list (with `*` wildcards) allows only those. A model that is not allowed answers 404.
- `aliases` gives a short name to a model. Every alias target must be allowed by `models`.

Keep the version pinned. A bare `"opencode-plugboard"` means `latest`, so a cache refresh can load code you have not read. Change the number on purpose, after reading the [changelog](https://github.com/jjjermiah/opencode-plugboard/blob/main/CHANGELOG.md). The snippet above always shows the latest release.

## 2. Restart OpenCode and touch the server once

OpenCode loads no plugin until a client connects, so the port stays closed until then:

```sh
opencode api get /api/agent
```

For an always-on server, run that call from the service unit. See [Serving other machines](guides/serving-other-machines.md#after-a-restart).

## 3. Call it

The listener is on `127.0.0.1:4010`. This prints `pong`:

```sh
curl -s http://127.0.0.1:4010/v1/chat/completions \
  -H "Authorization: Bearer $PLUGBOARD_KEY_MY_APP" \
  -H "Content-Type: application/json" \
  -d '{"model": "fast", "messages": [{"role": "user", "content": "reply with exactly: pong"}]}' \
  | jq -r '.choices[0].message.content'
```

The same call with the OpenAI Python SDK. Only the base URL and the key change:

```python
import os
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:4010/v1", api_key=os.environ["PLUGBOARD_KEY_MY_APP"])
r = client.chat.completions.create(model="fast", messages=[{"role": "user", "content": "reply with exactly: pong"}])
print(r.choices[0].message.content)
```

## If it does not answer

| You see | It means |
| --- | --- |
| Connection refused | OpenCode has not loaded the plugin. Run step 2. After every restart, run it again. |
| 401 `invalid_api_key` | The key is missing, wrong, or not in `keys`. |
| 404 `model_not_found` | The model is not in `models`, or the server does not have it enabled. `GET /v1/models` lists what you may use. |
| 403 `no_models_configured` | `models` is not set. Set `"models": "connected"` or list models. |
| 403 `invalid_host` | A loopback listener saw a `Host` header that is not `127.0.0.1`, `localhost` or `[::1]`. See [Serving other machines](guides/serving-other-machines.md). |

Open `http://127.0.0.1:4010/` in a browser for a setup page: the listen address, a `models` suggestion built from what your server offers, and a curl example.

## Next

- [Connect your app](connect.md): choose by API or by client.
- [Apps and keys](guides/apps-and-keys.md): one key per tool.
- [Configuration reference](configuration.md): every option.
