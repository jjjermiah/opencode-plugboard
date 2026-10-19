# Serving other machines

**The problem.** Your app runs on a laptop, in a container or behind a browser, not on the OpenCode host. And the OpenCode server runs all the time, so it must come back after a restart.

## Reach it from another host or container

Plugboard binds `127.0.0.1` by default, so only the OpenCode host can call it. To serve another machine, bind a specific address and set keys:

```jsonc plugboard
"listen": { "host": "192.0.2.10", "port": 4010 },
"keys": { "laptop": "{env:PLUGBOARD_KEY_LAPTOP}" }
```

What happens:

- A non-loopback `listen.host` refuses to start without `keys`.
- `listen` changes need an OpenCode restart.
- The endpoint speaks plain HTTP. The key crosses the network in clear text unless you encrypt the path.
- A container reaches the host through its gateway address, not through loopback. From Docker use `host.docker.internal`, and on Linux add `--add-host host.docker.internal:host-gateway`.

The container steps are in [reaching plugboard from another host or container](../clients/any-app.md#reaching-plugboard-from-another-host-or-container).

## Encrypt it

Choose one. Details and examples are in [Remote access](../remote-access.md).

| Option | Use it when |
| --- | --- |
| Tailscale or another tailnet | The devices are yours. Bind the tailnet address. The tailnet encrypts the traffic. |
| TLS reverse proxy (Caddy, Traefik, nginx) | A client cannot join the tailnet, or needs a public HTTPS name. |
| SSH tunnel | One machine you control. Keep the local port equal to `listen.port`. |

Then limit who can reach the port with a firewall or tailnet rules. Do not forward the port on your router.

## Browser apps

A web page on another origin can call plugboard only when that origin is named in `cors.origins`. Behind a proxy, also set `listen.trustProxy` so the Host check and the logs see the real client.

```jsonc plugboard
"keys": { "chat-ui": "{env:PLUGBOARD_KEY_CHAT}" },
"listen": { "host": "127.0.0.1", "port": 4010, "trustProxy": ["127.0.0.1"] },
"cors": { "origins": ["https://chat.example.net"] }
```

The proxy must send `X-Forwarded-Host` and `X-Forwarded-Proto`. Keep `keys` set.

## After a restart

OpenCode loads no plugin until a client touches the server, so after a restart the port stays closed. On an always-on server, add one call right after start, in the service unit:

```ini
[Service]
ExecStartPost=-/bin/sh -c 'for i in $(seq 1 30); do opencode api get /api/agent >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1'
```

`GET /readyz` answers `{"ready":true}` once the listener, the event pump and the model catalog are ready. Point a load balancer or monitor at it. [Warm-up](../warm-up.md) has the macOS launchd job and a unit that also sends one model request.

## Staying awake

OpenCode closes a location after an hour with no session activity, and that would close plugboard's listener. By default plugboard keeps its own location warm: every 30 minutes it creates one hidden child session. You do not need to do anything. Set `keepAlive: false` only if you run your own timer.

## One server per deployment

Limits, the cache and usage counts live in one OpenCode server process. Two servers behind one name do not share them. Run one OpenCode server per plugboard deployment.

## Checklist

- Bind a specific address, not `0.0.0.0`, and set `keys`.
- Restrict the port with a firewall or tailnet rules.
- Encrypt anything that crosses a network you do not control.
- Check from the client side:

```sh
curl http://<host-address>:4010/healthz
curl http://<host-address>:4010/v1/models -H "Authorization: Bearer $PLUGBOARD_KEY"
```

`/healthz` needs no key. A 401 means the key is wrong. A 403 `invalid_host` means a loopback bind is seeing a foreign `Host`. Connection refused means the bind, the firewall or the warm-up.

## Related options

All in the [configuration reference](../configuration.md#serving-other-machines):

- `listen.host`, `listen.port`, `requireKeys`
- [Reverse proxies: `listen.trustProxy`](../configuration.md#reverse-proxies)
- [Browser origins: `cors`](../configuration.md#browser-origins)
- `keepAlive`
- [Reloads and restarts](../configuration.md#reloads-and-restarts)
- [Security notes](../security.md)
