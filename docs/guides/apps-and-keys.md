# Apps and keys

**The problem.** Several tools share one OpenCode server: a Discord bot, n8n, a coding agent. If they share one key, you cannot tell their traffic apart, and you cannot cut one off without cutting all.

## Give each tool its own key

```jsonc
"keys": {
  "discord-bot": "{env:PLUGBOARD_KEY_DISCORD}",
  "n8n": "{env:PLUGBOARD_KEY_N8N}",
  "open-webui": "{env:PLUGBOARD_KEY_WEBUI}"
}
```

Each key name is an app. A request made with the `n8n` key is the app `n8n`. Callers send the key as `Authorization: Bearer <key>` (or `x-api-key` on the Anthropic routes). They never need the OpenCode server password.

What happens:

- Every request is filed under its app: history, usage, limits and metrics are all per app.
- Removing a key, or changing its value, takes effect on the running server at once. Adding a key needs an OpenCode restart.
- Without `keys`, the one app is `default`, and only local callers can reach it. On a shared machine, set `"requireKeys": true` so the server refuses to run without keys.
- App names match `[a-z0-9-]+`. Keep keys out of the file with `{env:VAR}`.

## Fix what an app may do

`apps` lets the server decide an app's behaviour, so you do not have to trust the app with it.

```jsonc
"apps": {
  "discord-bot": { "models": ["fast"], "model": "fast", "system": "Answer in two sentences.", "tools": false, "maxOutputTokens": 400 },
  "coding": { "models": ["anthropic/*"], "maxTools": 16 }
}
```

The `discord-bot` app always runs on `fast`, whatever model the bot sends. It gets the system prompt added, has its tools removed, and its answers stop at 400 output tokens. The request still succeeds. The response says what changed:

```
x-plugboard-policy: tools-stripped
```

An app with a policy still needs its key in `keys` (or `apps.<name>.key`).

## Lock a key to some endpoints

```jsonc
"apps": { "claude-code": { "endpoints": ["messages"] } }
```

A call to any other endpoint family answers 403 `endpoint_forbidden`.

## Add and revoke keys without a restart

Set `adminKey`. It is not a model key: it reads usage for every app and manages runtime keys.

```sh
curl -H "Authorization: Bearer $ADMIN_KEY" -H "content-type: application/json" \
  -d '{"app":"bot"}' http://127.0.0.1:4010/plugboard/admin/keys
```

The new key is shown once. The server keeps only a digest.

## Split one app by end user

A bot that serves many people is one app. Set `userHeader` on it and a proxy header such as `x-user-id` splits history and usage per user. Without it, plugboard reads the request's `user` field.

## Related options

All in the [configuration reference](../configuration.md#apps-and-keys):

- [`keys`, `adminKey`, `requireKeys`](../configuration.md#options)
- [Per-app policy: `models`, `model`, `system`, `tools`, `maxTools`, `maxN`, `maxOutputTokens`, `sampling`, `requestTimeoutMs`, `settleMs`](../configuration.md#per-app-policy-apps)
- [Endpoint names](../configuration.md#endpoint-names)
- [Server tools](../configuration.md#per-app-policy-apps) (`serverTools`): let an app's key run OpenCode tools. Read the security warning first.
- [Admin keys](../configuration.md#admin-keys) and [which key opens which route](../configuration.md#which-key-opens-which-route)
- [End users](../configuration.md#end-users)

Next: [Models, aliases and fallbacks](models-and-aliases.md).
