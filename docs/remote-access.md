# Remote access

Plugboard listens on `127.0.0.1` by default, so only the OpenCode host can call it. Read this page before a client on another machine, a container on another network, or a browser outside the host reaches it. The first bind and the container steps are in [reaching plugboard from another host or container](clients/any-app.md#reaching-plugboard-from-another-host-or-container). This page covers how to do that safely.

## When you need it

- A client on another machine or network needs a non-loopback `listen.host`, or a tunnel to the loopback port.
- A container on the same host reaches the host through its gateway address, which needs the non-loopback bind.
- If the only client is on the OpenCode host, keep the loopback bind and do not read further.

## What plugboard protects and what it does not

- **Plain HTTP on every bind.** Plugboard adds no encryption. A non-loopback `listen.host` refuses to start without `keys`, and the key then crosses the network in the `Authorization` header, readable by anyone on the path. Encrypt the path (a tunnel) or put a TLS proxy in front.
- **The admin key is a bearer key too.** `adminKey` reads every app's usage, and it crosses the wire the same way.
- **Keyless loopback is not user isolation.** Without `keys`, every caller is the app `default`. Any process or local user that can open a TCP connection to `127.0.0.1:<port>` gets your provider logins. On a shared machine, set `keys`. Unix file permissions do not separate users on a TCP port.
- **The `Host` and `Origin` checks are for browsers.** They stop a web page in your browser from calling a loopback listener. They do not authenticate anyone, and they do not apply to a non-loopback bind.

## Options

### Tailscale or another tailnet

This is the simplest option for devices you own. Bind plugboard to the host's tailnet address, not to `0.0.0.0`, and set keys:

```jsonc
"listen": { "host": "100.101.102.103", "port": 4010 },
"keys": { "laptop": "{env:PLUGBOARD_KEY_LAPTOP}" }
```

Traffic between tailnet nodes is encrypted by Tailscale, so the key is not sent in clear text across your LAN or the internet. Only nodes that can reach that address can connect, and Tailscale ACLs decide which ones. Plugboard's own checks do not apply to this bind, so keys and ACLs are the controls.

### TLS reverse proxy

Use a proxy when a client cannot join the tailnet, or when a client needs a public HTTPS name. Terminate TLS in the proxy and keep plugboard off any interface a stranger can reach.

There are two layouts, and they differ in the `Host` header:

- **Private bind (recommended).** Plugboard binds a private interface address with `keys` set. The proxy forwards to that address. The `Host` check does not apply to a non-loopback bind, so the proxy passes `Host` unchanged.
- **Loopback bind.** Plugboard stays on `127.0.0.1`. The proxy must send `Host: 127.0.0.1:<port>` upstream, or plugboard answers 403 `invalid_host`. Set `keys` anyway. Without them, every request the proxy forwards is the app `default`, so anyone who reaches the proxy gets your logins.

Caddy, private bind. Streamed answers are sent as they arrive with `flush_interval -1`:

```
plugboard.example.com {
	reverse_proxy 192.0.2.10:4010 {
		flush_interval -1
	}
}
```

Caddy, loopback bind:

```
plugboard.example.com {
	reverse_proxy 127.0.0.1:4010 {
		header_up Host 127.0.0.1:4010
		flush_interval -1
	}
}
```

Caddy gets a certificate for a public name automatically, which needs DNS for that name pointing at the proxy and ports 80 and 443 open for the ACME challenge. For a name that only resolves inside your network, use `tls internal` or your own certificate.

Traefik, file provider, loopback bind. `passHostHeader: false` makes Traefik send the upstream address as `Host`, which is what the loopback check expects. For a private bind the same setting is harmless. The `certResolver` must name a resolver you already run:

```yaml
http:
  routers:
    plugboard:
      rule: "Host(`plugboard.example.com`)"
      entryPoints: [websecure]
      service: plugboard
      tls:
        certResolver: letsencrypt
  services:
    plugboard:
      loadBalancer:
        passHostHeader: false
        servers:
          - url: "http://127.0.0.1:4010"
```

Check your proxy with a streamed request (`stream: true`) and the `/v1/models` call in the [checklist](#checklist) before you rely on it.

### SSH tunnel

For one machine you control, forward the loopback port over SSH:

```sh
ssh -N -L 4010:127.0.0.1:4010 <server>
```

The client then uses `http://127.0.0.1:4010/v1` with a key. Keep the local port equal to `listen.port`, because the `Host` check compares the port. Set `keys` on the server anyway: a keyless loopback bind trusts every local user on that server, and the tunnel's traffic arrives from that loopback.

## Browser apps behind a reverse proxy

A browser UI on another origin calls plugboard only when that origin is named in `cors.origins` (see [configuration](configuration.md#browser-origins)). Behind a TLS proxy, list the public origin the browser sees, such as `https://chat.example.net`, and trust the proxy's address with `listen.trustProxy` so the Host check and the logs see the real client.

```jsonc
"keys": { "chat-ui": "{env:PLUGBOARD_KEY_CHAT}" },
"listen": { "host": "127.0.0.1", "port": 4010, "trustProxy": ["127.0.0.1"] },
"cors": { "origins": ["https://chat.example.net"] }
```

The proxy must send `X-Forwarded-Host` and `X-Forwarded-Proto`. Keep `keys` set: a keyless endpoint never takes the forwarded host (see [reverse proxies](configuration.md#reverse-proxies)).

## Remote image URLs

A request may name an `http(s)` image URL, and the server fetches it when `remoteImages` is on. From a remote deployment, prefer the stricter choice: `"remoteImages": { "schemes": ["https"], "maxBytes": 5242880, "maxRedirects": 0 }`, plus `allow` for each internal image host. Every field is listed in [configuration](configuration.md#remote-image-limits).

## Firewall

Whichever bind you choose, let only the clients that need it reach the port, and drop the rest. Example with `ufw` on the plugboard host. Rules match in order, so the allow comes first:

```sh
sudo ufw allow from 192.0.2.0/24 to any port 4010 proto tcp
sudo ufw deny 4010/tcp
```

Do not forward port 4010 on your router. If a service outside your network must reach plugboard, expose only the TLS proxy's port, and keep `keys` set. Container runtimes that publish ports can bypass `ufw` rules, so check from outside the host that the port does not answer.

## Keys over plain HTTP

Anyone who can read the traffic gets the key, and with it can spend provider quota on the models in `models`. If a key crossed a network you do not trust, rotate it: change its value in `keys`. A changed value applies at once (see [Reloads and restarts](configuration.md#reloads-and-restarts)). Then update the client.

## One replica per OpenCode server

Each OpenCode server runs its own plugboard process. The response cache and the concurrency and rate limits live in that process, and so do the in-memory usage counts. Two servers behind one name do not share them. A cache hit on one replica is a miss on the other, and a per-app limit applies to each replica separately. Budgets read the usage records, so do not rely on a budget being shared across replicas. A restart clears limits and the cache. Usage survives a restart only as far as it was written to storage.

Run one OpenCode server per plugboard deployment. If you need more capacity, size `limits` and `budgets` for one process, and do not put a load balancer in front of two servers and expect the caps to hold. Keep [warm-up](warm-up.md) in mind too: after a restart the port stays closed until a client touches the server.

## Checklist

- Bind a specific address, not `0.0.0.0`, and set `keys`.
- Restrict the port with a firewall or tailnet ACL. Do not expose it to the internet.
- Encrypt anything that crosses a network you do not control: a tailnet, a TLS proxy or an SSH tunnel.
- Run one OpenCode server per deployment.
- Check from the client side:

```sh
curl http://<host-address>:4010/healthz
curl http://<host-address>:4010/v1/models -H "Authorization: Bearer $PLUGBOARD_KEY"
```

`/healthz` needs no key. A 401 means the key is missing or wrong. A 403 `invalid_host` means a loopback bind is seeing a foreign `Host`. Connection refused means the bind, the firewall or the warm-up.
