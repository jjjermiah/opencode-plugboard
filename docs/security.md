# Security

Plugboard runs inside your OpenCode server, next to your provider logins. These are the rules it keeps, and the ones you have to keep.

## What plugboard guarantees

- **Callers never run OpenCode's tools.** A caller's tools come back to the caller. OpenCode's own tools run only for an app you list in `opencodeTools`, and only the tools you name.
- **Apps are separate.** Each app has its own key, its own session directory, its own usage and its own cache entries. One app cannot read another's history.
- **Loopback by default.** The listener binds `127.0.0.1`. A non-loopback `listen.host` refuses to start without `keys`. On a loopback bind, a `Host` header that is not `localhost`, `127.0.0.1` or `[::1]` gets a 403, which stops DNS rebinding.
- **No browser access unless you allow it.** A page from an origin not in `cors.origins` gets no CORS header, and `"*"` needs keys.
- **Remote images are off.** With `remoteImages` on, the server fetches only public addresses unless you allow more.
- **The admin key reads.** `adminKey` opens usage, status and metrics. It cannot call a model, and it must differ from every app key.

## What you have to do

- **Keep keys out of the config file.** Use `{env:VAR}` and keep the values in the environment or a secret store. Give every app its own key.
- **Protect the network path.** Plugboard speaks plain HTTP, so keys cross the network in clear text. For remote access, allow only known addresses in the firewall, tunnel over SSH, or put a TLS proxy in front. See [Serving other machines](guides/serving-other-machines.md).
- **On a shared machine, require keys.** Without `keys`, any local process can call the `default` app. Set `"requireKeys": true` so every request needs a key.
- **Pin the version.** The plugin sees your provider logins. Update it on purpose, after reading the changelog.

## Reporting and reviews

- Report a vulnerability privately, as [SECURITY.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/SECURITY.md) explains. Do not open a public issue.
- [Security reviews](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/security-reviews.md): what was reviewed, by whom, and what was found. They are AI-assisted reviews, not an audit.
- [Red team](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/red-team.md): how the red-team rounds are run.
- [Best practices](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/best-practices.md): the OpenSSF Best Practices answers.
