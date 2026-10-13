# Security policy

## Reporting a vulnerability

Please report it privately. Do not open a public issue.

Use GitHub's private vulnerability reporting: go to the [Security tab](https://github.com/jjjermiah/opencode-plugboard/security) of the repository and choose "Report a vulnerability". Include the plugboard version, the OpenCode version, your `listen` and `remoteImages` settings (with keys removed) and the smallest request that shows the problem.

I acknowledge a report within 7 days. For a confirmed issue I aim to ship a fix within 30 days. These are targets for a one-person project, not a contract, and there is no bounty. If a report is valid I will say so, fix it, and credit you in the changelog unless you prefer not to be named.

Disclosure is coordinated. Once a fix is ready, I will agree a disclosure date with you and publish a GitHub security advisory that names the fixed version. If a fix will take longer than 30 days, I will tell you why and roughly when to expect it.

## What is in scope

- Exposure of API keys, provider credentials or OpenCode tokens (in responses, logs or history).
- Requests the plugin makes that the operator did not ask for, including `remoteImages` reaching internal addresses it should not.
- Bypasses of the key check, the `Host` check or the `Origin` check.
- A caller making OpenCode run a tool. Tool calls go back to the caller, and OpenCode must never execute them.
- A caller reaching a model or a request path the `models` allowlist or `keys` should have blocked.
- The release supply chain: a published package that does not match the repository, or a tampered workflow.

Out of scope: problems in OpenCode itself, in a provider, or in a client that talks to plugboard. Report those upstream.

## Supported versions

While the major version is 0, only the latest release gets fixes. Upgrade to the newest 0.x before reporting, if you can.

## Threat model

Plugboard binds a port inside your OpenCode server and answers with your provider logins. Read this before exposing it.

- The default bind is `127.0.0.1`. The `Host` and `Origin` checks exist to stop a web page in your browser from talking to it. They only protect a loopback bind.
- A keyless server serves every local caller as the app `default`. On a shared machine, set `requireKeys: true` (since 0.26.0): the plugin then refuses to load without `keys`, and every request needs a key, loopback included.
- `cors.origins` (since 0.26.0) lists the browser origins that may call plugboard. An origin off the list gets no CORS header, so a page on another site cannot read the answer. The preflight is answered without a key, but the actual request still needs one on a keyed endpoint. `"*"` needs keys, and `allowPrivateNetwork` is off by default.
- A non-loopback `listen.host` refuses to start without `keys`. Keys are bearer secrets. Anyone holding one can spend your provider quota on the models in `models`, and their prompts are stored as OpenCode sessions in your database. Put network controls in front of a non-loopback bind: a firewall, a private network, or a reverse proxy with TLS. Plugboard serves plain HTTP.
- `remoteImages` is off by default. Turning it on lets callers make the server request `http(s)` URLs, which is an SSRF risk toward your internal network. Leave it off unless callers need it. They can always send `data:` URLs.
- `apps.<name>.serverTools` is off by default. Turning it on lets whoever holds that app's key make the model call the listed OpenCode tools, which then run with the server's own credentials and permissions. The prompt chooses the arguments, so the key is close to a shell key for the tools it names. Plugboard allows only the listed exact ids, checks they exist when the request arrives, and rejects the keyless `default` app, but it cannot restrict what a listed tool does. It refuses `execute`, `subagent` and `task`, which would run other tools or start a child session outside the deny-all. A listed tool runs under the agent's own OpenCode allow and deny rules, not around them: a tool the agent does not allow is refused at the request, and a resource the agent denies stays denied (#194). Server calls after a request ends are logged and the session is interrupted again (#196). List the fewest tools, keep the key to one trusted caller, and never list tools on a shared or keyless app.
- `metrics: true` exposes per-app request, error, token and limit counts. With `adminKey` set, only the admin key reads `/plugboard/metrics`. Without `adminKey`, any app key reads every app's series, so set `adminKey` before you enable metrics on a server whose apps should not see each other's traffic.
- `x-plugboard-session-url` (option `historyUrl`) shows the OpenCode server's address to every app that receives it. Set `apps.<name>.historyUrl` to `false` for an app you do not trust with that address.
- Debug logs and captured traffic can contain prompts and tool arguments. Treat them as sensitive. The `server_tool.call` log line never carries arguments or output.
- Plugboard trusts OpenCode. A hostile OpenCode, plugin or config on the same server is out of scope.

## Security reviews

On 2026-10-12 the project had three AI-assisted staff reviews (security and legal, architecture and bugs, product and developer experience). They were AI reviews, not a human or third-party audit, and the maintainer is accountable for the changes that came out of them. What each one found, and where it was fixed, is in [docs/security-reviews.md](docs/security-reviews.md).
