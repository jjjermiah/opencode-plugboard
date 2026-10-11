# Security policy

## Reporting a vulnerability

Please report it privately. Do not open a public issue.

Use GitHub's private vulnerability reporting: go to the [Security tab](https://github.com/jjjermiah/opencode-plugboard/security) of the repository and choose "Report a vulnerability". Include the plugboard version, the OpenCode version, your `listen` and `remoteImages` settings (with keys removed) and the smallest request that shows the problem.

I read reports as they come in and aim to reply within a week. This is a one-person project, so there is no bounty and no formal SLA. If a report is valid I will say so, fix it, and credit you in the changelog unless you prefer not to be named.

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
- A non-loopback `listen.host` refuses to start without `keys`. Keys are bearer secrets. Anyone holding one can spend your provider quota on the models in `models`, and their prompts are stored as OpenCode sessions in your database. Put network controls in front of a non-loopback bind: a firewall, a private network, or a reverse proxy with TLS. Plugboard serves plain HTTP.
- `remoteImages` is off by default. Turning it on lets callers make the server request `http(s)` URLs, which is an SSRF risk toward your internal network. Leave it off unless callers need it. They can always send `data:` URLs.
- Debug logs and captured traffic can contain prompts and tool arguments. Treat them as sensitive.
- Plugboard trusts OpenCode. A hostile OpenCode, plugin or config on the same server is out of scope.
